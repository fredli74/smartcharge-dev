/**
 * @file TeslaAPI helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { RestClient, RestClientError, Options } from "@shared/restclient";
import config from "./tesla-config";
import { log, LogLevel } from "@shared/utils";
import { TeslaToken } from ".";

function time(): number {
  return Math.floor(new Date().valueOf() / 1e3);
}

export class TeslaAPI {
  constructor(private ownerAPI: RestClient, private authAPI: RestClient) {}

  public static tokenExpired(token: TeslaToken): boolean {
    return token.expires_at <= time();
  }

  public parseTokenResponse(response: any): TeslaToken {
    // Parse the token response
    if (typeof response.access_token !== "string") {
      throw new RestClientError(
        `Error parsing Tesla oauth2 v3 token response, missing access_token ${JSON.stringify(
          response
        )}`,
        500
      );
    }
    if (typeof response.refresh_token !== "string") {
      throw new RestClientError(
        `Error parsing Tesla oauth2 v3 token response, missing refresh_token ${JSON.stringify(
          response
        )}`,
        500
      );
    }
    const expires = Number.parseInt(response.expires_in);
    if (!Number.isInteger(expires)) {
      throw new RestClientError(
        `Error parsing Tesla oauth2 v3 token response, invalid expires_in ${JSON.stringify(
          response
        )}`,
        500
      );
    }

    return {
      access_token: response.access_token,
      expires_at: time() + expires - parseInt(config.TOKEN_EXPIRATION_WINDOW),
      refresh_token: response.refresh_token,
    };
  }

  public async authorize(
    code: string,
    callbackURI: string
  ): Promise<TeslaToken> {
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

  public async renewToken(refresh_token: string): Promise<TeslaToken> {
    try {
      log(LogLevel.Trace, `renewToken(${refresh_token})`);

      // Tesla authAPI expects form data in the body
      const formData = new URLSearchParams();
      formData.append("grant_type", "refresh_token");
      formData.append("client_id", config.TESLA_CLIENT_ID);
      formData.append("refresh_token", refresh_token);

      const authResponse = (await this.authAPI.post("/oauth2/v3/token", formData.toString())) as any;
      return this.parseTokenResponse(authResponse);
    } catch (e) {
      console.debug(`TeslaAPI.renewToken error: ${e}`);
      throw e;
    }
  }

  public async wakeUp(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/wake_up`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `wakeUp(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async setChargeLimit(id: string, limit: number, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/set_charge_limit`,
      { percent: limit },
      token.access_token
    );
    log(
      LogLevel.Trace,
      `setChargeLimit(${id}, ${limit}) => ${JSON.stringify(result)}`
    );
    return result;
  }
  public async chargeStart(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/charge_start`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `chargeStart(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async chargeStop(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/charge_stop`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `chargeStop(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async openChargePort(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/charge_port_door_open`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `openChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async closeChargePort(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/charge_port_door_close`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `closeChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOn(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_start`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `climateOn(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOff(id: string, token: TeslaToken) {
    const result = await this.ownerAPI.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_stop`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `climateOff(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async listVehicle(id: string | undefined, token: TeslaToken) {
    if (id === undefined) {
      return await this.ownerAPI.get(`/api/1/vehicles`, token.access_token);
    } else {
      return await this.ownerAPI.get(
        `/api/1/vehicles/${id}`,
        token.access_token
      );
    }
  }
  public async getVehicleData(id: string, token: TeslaToken) {
    return await this.ownerAPI.get(
      `/api/1/vehicles/${id}/vehicle_data?endpoints=charge_state%3Bclimate_state%3Bdrive_state%3Blocation_data%3Bvehicle_config%3Bvehicle_state`,
      token.access_token
    );
  }
  public async getVehicleOptions(id: string, token: TeslaToken) {
    return await this.ownerAPI.get(
      `/api/1/dx/vehicles/options?vin=${id}`,
      token.access_token
    );
  }
}

let apiClient: RestClient;
if (config.TESLA_COMMAND_PROXY !== "") {
  const url = new URL(config.TESLA_COMMAND_PROXY as any);
  const options: Options = {
    baseURL: url.origin,
    timeout: 120e3,
    headers: {
      Accept: "*/*",
      "User-Agent": "smartcharge.dev/1.0",
    }
  };
  if (url.username && url.password) {
    const creds = Buffer.from(`${url.username}:${url.password}`).toString(
      `base64`
    );
    options.headers!.Authorization = `Basic ${creds}`;
  }
  apiClient = new RestClient(options);
} else {
  apiClient = new RestClient({
    baseURL: config.TESLA_API_BASE_URL,
    proxy: config.TESLA_API_PROXY,
    timeout: 120e3,
    headers: {
      Accept: "*/*",
      "User-Agent": "smartcharge.dev/1.0",
    }
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
  }
});

const teslaAPI = new TeslaAPI(apiClient, authClient);

export default teslaAPI;
