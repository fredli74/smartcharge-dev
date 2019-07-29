/**
 * @file TeslaAPI helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient, IRestToken } from "@shared/restclient";
import { PROJECT_AGENT } from "@shared/smartcharge-globals";
import config from "./tesla-config";
import { log, LogLevel } from "@shared/utils";

export class TeslaAPI extends RestClient {
  public static async authenticate(
    email: string,
    password: string
  ): Promise<IRestToken> {
    try {
      return (await teslaAPI.getToken("/oauth/token?grant_type=password", {
        grant_type: "password",
        client_id: config.TESLA_CLIENT_ID,
        client_secret: config.TESLA_CLIENT_SECRET,
        email: email,
        password: password
      })) as IRestToken;
    } catch (error) {
      log(
        LogLevel.Debug,
        `TeslaAgent.Authenticate error: ${error.data.response}`
      );
      throw error;
    }
  }
  public static async maintainToken(
    token: IRestToken
  ): Promise<IRestToken | false> {
    if (typeof token !== "object") {
      throw new Error("invalid token");
    }
    assert(typeof token.refresh_token === "string");
    assert(token.refresh_token!.length === 64);

    if (!token.access_token || RestClient.tokenExpired(token)) {
      log(LogLevel.Debug, `token renewal`);
      return (await teslaAPI.getToken("/oauth/token?grant_type=refresh_token", {
        grant_type: "refresh_token",
        client_id: config.TESLA_CLIENT_ID,
        client_secret: config.TESLA_CLIENT_SECRET,
        refresh_token: token.refresh_token
      })) as IRestToken;
    } else {
      return false;
    }
  }

  public static async wakeUp(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/wake_up`,
      undefined,
      token
    );
    log(LogLevel.Trace, `wakeUp(${id}) => ${JSON.stringify(result)}`);
  }
  public static async setChargeLimit(
    id: string,
    limit: number,
    token: IRestToken
  ) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/set_charge_limit`,
      { percent: limit },
      token
    );
    log(
      LogLevel.Trace,
      `setChargeLimit(${id}, ${limit}) => ${JSON.stringify(result)}`
    );
  }
  public static async chargeStart(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_start`,
      undefined,
      token
    );
    log(LogLevel.Trace, `chargeStart(${id}) => ${JSON.stringify(result)}`);
  }
  public static async chargeStop(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_stop`,
      undefined,
      token
    );
    log(LogLevel.Trace, `chargeStop(${id}) => ${JSON.stringify(result)}`);
  }
  public static async openChargePort(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_port_door_open`,
      undefined,
      token
    );
    log(LogLevel.Trace, `openChargePort(${id}) => ${JSON.stringify(result)}`);
  }
  public static async closeChargePort(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_port_door_close`,
      undefined,
      token
    );
    log(LogLevel.Trace, `closeChargePort(${id}) => ${JSON.stringify(result)}`);
  }
  public static async climateOn(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_start`,
      undefined,
      token
    );
    log(LogLevel.Trace, `climateOn(${id}) => ${JSON.stringify(result)}`);
  }
  public static async climateOff(id: string, token: IRestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_stop`,
      undefined,
      token
    );
    log(LogLevel.Trace, `climateOff(${id}) => ${JSON.stringify(result)}`);
  }
  public static async listVehicle(id: string | undefined, token: IRestToken) {
    if (id === undefined) {
      return await teslaAPI.get(`/api/1/vehicles`, token);
    } else {
      return await teslaAPI.get(`/api/1/vehicles/${id}`, token);
    }
  }
  public static async getVehicleData(id: string, token: IRestToken) {
    return await teslaAPI.get(`/api/1/vehicles/${id}/vehicle_data`, token);
  }
}
const teslaAPI = new RestClient({
  baseURL: config.TESLA_API_BASE_URL,
  agent: `${PROJECT_AGENT}`,
  timeout: 120000
});
export default teslaAPI;
