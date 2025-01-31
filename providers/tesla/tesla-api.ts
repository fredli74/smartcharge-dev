/**
 * @file TeslaAPI helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { RestClient, RestClientError, Options } from "@shared/restclient.js";
import config from "./tesla-config.js";
import { log, LogLevel } from "@shared/utils.js";
import { TeslaToken } from "./index.js";

function time(): number {
  return Math.floor(new Date().valueOf() / 1e3);
}

export interface TeslaTelemetryConfig {
  config: {
    hostname: string;
    port: number;
    ca: string;
    fields: {
      [key: string]: {
        interval_seconds: number
        minimum_delta?: number
        resend_interval_seconds?: number
      };
    };
    prefer_typed?: boolean;
    alert_types?: string[];
    exp?: number;
  };
  vins: string[];
}
const TeslaScheduleDays = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "All"
];
interface TeslaSchedule {
  id?: number;
  name?: string;
  days_of_week: number;
  one_time?: boolean;
  enabled: boolean;
  latitude: number;
  longitude: number;
}
export interface TeslaChargeSchedule extends TeslaSchedule {
  start_enabled: boolean;
  start_time?: number;
  end_enabled: boolean;
  end_time?: number;
}
export interface TeslaPreconditionSchedule extends TeslaSchedule {
  precondition_time: number;
}

// Convert a Tesla days_of_week bitmask and time and convert it to the first upcoming date
export function TeslaScheduleTimeToDate(days_of_week: number, time: number): Date | null {
  // Tesla uses a bitmask for days of the week, starting with Sunday
  const when = new Date();
  const dayOfWeek = when.getUTCDay();
  for (let i = 0; i < 7; ++i) {
    if (days_of_week & (1 << ((dayOfWeek + i) % 7))) {
      // Add i days to the current date
      when.setUTCDate(when.getUTCDate() + i);
      when.setUTCHours(Math.floor(time / 60), time % 60, 0, 0);
      return when;
    }
  }
  return null;
}

/**
 * Converts a days_of_week bitmask to a human-readable string.
 * @param days_of_week - The bitmask for the days of the week.
 * @returns A `Date` object representing the schedule time.
 */
export function DaysOfWeekToString(days_of_week: number): string {
  return (days_of_week === 0b1111111 ? TeslaScheduleDays[7] : TeslaScheduleDays.filter((_, i) => days_of_week & (1 << i)).join(","));
}

export class TeslaAPI {
  constructor(private commandProxy: RestClient, private authAPI: RestClient) { }

  public static tokenExpired(token: TeslaToken): boolean {
    return token.expires_at <= time();
  }

  public parseTokenResponse(response: any): TeslaToken {
    // Parse the token response
    if (typeof response.access_token !== "string") {
      throw new RestClientError(`Error parsing Tesla oauth2 v3 token response, missing access_token ${JSON.stringify(response)}`, 500);
    }
    if (typeof response.refresh_token !== "string") {
      throw new RestClientError(`Error parsing Tesla oauth2 v3 token response, missing refresh_token ${JSON.stringify(response)}`, 500);
    }
    const expires = Number.parseInt(response.expires_in);
    if (!Number.isInteger(expires)) {
      throw new RestClientError(`Error parsing Tesla oauth2 v3 token response, invalid expires_in ${JSON.stringify(response)}`, 500);
    }

    return {
      access_token: response.access_token,
      expires_at: time() + expires - config.TOKEN_EXPIRATION_WINDOW,
      refresh_token: response.refresh_token,
    };
  }

  public async authorize(code: string, callbackURI: string): Promise<TeslaToken> {
    try {
      log(LogLevel.Trace, `authorize(${code}, ${callbackURI})`);

      // Tesla authAPI expects form data in the body
      const formData = new URLSearchParams();
      formData.append("grant_type", "authorization_code");
      formData.append("client_id", config.TESLA_CLIENT_ID);
      formData.append("client_secret", config.TESLA_CLIENT_SECRET);
      formData.append("code", code);
      formData.append("audience", config.TESLA_API_BASE_URL);
      formData.append("redirect_uri", callbackURI);

      const authResponse = (await this.authAPI.post("/oauth2/v3/token", formData.toString())) as any;
      return this.parseTokenResponse(authResponse);
    } catch (e) {
      console.debug(`TeslaAPI.authorize error: ${e}`);
      throw e;
    }
  }

  /**
   * WARNING: This function is not safe for multiple concurrent calls with the same refresh_token.
   * Ensure that only one call is made at a time for each refresh_token.
   * @throws Will throw an error if the function is called concurrently with the same refresh_token.
   */
  private renewTokenLock: Set<string> = new Set();
  public async renewToken(refresh_token: string): Promise<TeslaToken> {
    if (this.renewTokenLock.has(refresh_token)) {
      throw new RestClientError(`Concurrent renewToken(${refresh_token}) calls are not allowed`, 500);
    }
    this.renewTokenLock.add(refresh_token);
    try {
      log(LogLevel.Trace, `TeslaAPI.renewToken(${refresh_token})`);

      // Tesla authAPI expects form data in the body
      const formData = new URLSearchParams();
      formData.append("grant_type", "refresh_token");
      formData.append("client_id", config.TESLA_CLIENT_ID);
      formData.append("refresh_token", refresh_token);

      const authResponse = (await this.authAPI.post("/oauth2/v3/token", formData.toString())) as any;
      log(LogLevel.Trace, `TeslaAPI.renewToken(${refresh_token}) response: ${JSON.stringify(authResponse)}`);
      return this.parseTokenResponse(authResponse);
    } catch (e) {
      console.debug(`TeslaAPI.renewToken(${refresh_token}) error: ${e}`);
      throw e;
    } finally {
      this.renewTokenLock.delete(refresh_token);
    }
  }

  public async wakeUp(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/wake_up`, undefined, token.access_token);
    log(LogLevel.Trace, `wakeUp(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async setChargeLimit(id: string, limit: number, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/set_charge_limit`, { percent: limit }, token.access_token);
    log(LogLevel.Trace, `setChargeLimit(${id}, ${limit}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async chargeStart(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/charge_start`, undefined, token.access_token);
    log(LogLevel.Trace, `chargeStart(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async chargeStop(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/charge_stop`, undefined, token.access_token);
    log(LogLevel.Trace, `chargeStop(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async openChargePort(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/charge_port_door_open`, undefined, token.access_token);
    log(LogLevel.Trace, `openChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async closeChargePort(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/charge_port_door_close`, undefined, token.access_token);
    log(LogLevel.Trace, `closeChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOn(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/auto_conditioning_start`, undefined, token.access_token);
    log(LogLevel.Trace, `climateOn(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOff(id: string, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${id}/command/auto_conditioning_stop`, undefined, token.access_token);
    log(LogLevel.Trace, `climateOff(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async listVehicle(id: string | undefined, token: TeslaToken) {
    if (id === undefined) {
      return await this.commandProxy.get(`/api/1/vehicles`, token.access_token);
    } else {
      return await this.commandProxy.get(`/api/1/vehicles/${id}`, token.access_token);
    }
  }
  public async getVehicleData(id: string, token: TeslaToken) {
    throw new Error("Method should not be used anymore");
    return await this.commandProxy.get(
      `/api/1/vehicles/${id}/vehicle_data?endpoints=charge_state%3Bclimate_state%3Bdrive_state%3Blocation_data%3Bvehicle_config%3Bvehicle_state`,
      token.access_token
    );
  }
  public async getVehicleOptions(id: string, token: TeslaToken) {
    const result = await this.commandProxy.get(`/api/1/dx/vehicles/options?vin=${id}`, token.access_token);
    log(LogLevel.Trace, `getVehicleOptions(${id}) => ${JSON.stringify(result)}`);
    return result;
  }

  public async createFleetTelemetryConfig(conf: TeslaTelemetryConfig, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/fleet_telemetry_config`, conf, token.access_token);
    log(LogLevel.Trace, `createFleetTelemetryConfig(${JSON.stringify(conf)}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async getFleetTelemetryConfig(vin: string, token: TeslaToken) {
    const result = await this.commandProxy.get(`/api/1/vehicles/${vin}/fleet_telemetry_config`, token.access_token);
    log(LogLevel.Trace, `getFleetTelemetryConfig(${vin}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async deleteFleetTelemetryConfig(vin: string, token: TeslaToken) {
    const result = await this.commandProxy.delete(`/api/1/vehicles/${vin}/fleet_telemetry_config`, token.access_token);
    log(LogLevel.Trace, `deleteFleetTelemetryConfig(${vin}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async getVehicleSchedules(vin: string, token: TeslaToken) {
    const result = await this.commandProxy.get(
      `/api/1/vehicles/${vin}/vehicle_data?endpoints=preconditioning_schedule_data%3Bcharge_schedule_data`, token.access_token
    );
    log(LogLevel.Trace, `getVehicleSchedules(${vin}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async addChargeSchedule(vin: string, schedule: TeslaChargeSchedule, token: TeslaToken) {
    // Stupidly Tesla uses a bitmask for days_of_week, when you read it, but a "," delimited string of TeslaScheduleDays when you set it
    // They also use lat,lon on add, but latitute,longitude on read
    const s = Object.entries(schedule).reduce((acc, [k, v]) => {
      if (v === undefined) return acc;
      switch(k) {
        case "latitude": acc["lat"] = v; break;
        case "longitude": acc["lon"] = v; break;
        case "days_of_week": acc["days_of_week"] = DaysOfWeekToString(v); break;
        default: acc[k] = v; break;
      }
      return acc;
    }, {} as any);
    const result = await this.commandProxy.post(`/api/1/vehicles/${vin}/command/add_charge_schedule`, s, token.access_token);
    log(LogLevel.Trace, `addChargeSchedule(${vin}, ${JSON.stringify(schedule)}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async removeChargeSchedule(vin: string, id: number, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${vin}/command/remove_charge_schedule`, { id: id }, token.access_token);
    log(LogLevel.Trace, `removeChargeSchedule(${vin}, ${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async addPreconditionSchedule(vin: string, schedule: TeslaPreconditionSchedule, token: TeslaToken) {
    // Stupidly Tesla uses a bitmask for days_of_week, when you read it, but a "," delimited string of TeslaScheduleDays when you set it
    const s = Object.entries(schedule).reduce((acc, [k, v]) => {
      if (v === undefined) return acc;
      switch(k) {
        case "latitude": acc["lat"] = v; break;
        case "longitude": acc["lon"] = v; break;
        case "days_of_week": acc["days_of_week"] = DaysOfWeekToString(v); break;
        default: acc[k] = v; break;
      }
      return acc;
    }, {} as any);
    const result = await this.commandProxy.post(`/api/1/vehicles/${vin}/command/add_precondition_schedule`, s, token.access_token);
    log(LogLevel.Trace, `addPreconditionSchedule(${vin}, ${JSON.stringify(schedule)}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async removePreconditionSchedule(vin: string, id: number, token: TeslaToken) {
    const result = await this.commandProxy.post(`/api/1/vehicles/${vin}/command/remove_precondition_schedule`, { id: id }, token.access_token);
    log(LogLevel.Trace, `removePreconditionSchedule(${vin}, ${id}) => ${JSON.stringify(result)}`);
    return result;
  }
}

let commandProxy: RestClient;
if (config.TESLA_COMMAND_PROXY !== "") {
  const url = new URL(config.TESLA_COMMAND_PROXY as any);
  const options: Options = {
    baseURL: url.origin,
    timeout: 120e3,
    headers: {
      Accept: "*/*",
      "User-Agent": "smartcharge.dev/1.0",
    },
  };
  if (url.username && url.password) {
    const creds = Buffer.from(`${url.username}:${url.password}`).toString(
      `base64`
    );
    options.headers!.Authorization = `Basic ${creds}`;
  }
  commandProxy = new RestClient(options);
} else {
  commandProxy = new RestClient({
    baseURL: config.TESLA_API_BASE_URL,
    proxy: config.TESLA_API_PROXY,
    timeout: 120e3,
    headers: {
      Accept: "*/*",
      "User-Agent": "smartcharge.dev/1.0",
    },
  });
}
const authClient = new RestClient({
  baseURL: config.TESLA_AUTH_BASE_URL,
  proxy: config.TESLA_AUTH_PROXY,
  timeout: 60e3,
  headers: {
    Accept: "*/*",
    "User-Agent": "smartcharge.dev/1.0",
    "Content-Type": "application/x-www-form-urlencoded",
  },
});

const teslaAPI = new TeslaAPI(commandProxy, authClient);

export default teslaAPI;
