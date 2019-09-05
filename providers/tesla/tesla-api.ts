/**
 * @file TeslaAPI helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient, IRestToken } from "@shared/restclient";
import { PROJECT_AGENT } from "@shared/smartcharge-globals.json";
import config from "./tesla-config";
import { log, LogLevel } from "@shared/utils";
import provider from ".";

export class TeslaAPI extends RestClient {
  public async authenticate(
    email: string,
    password: string
  ): Promise<IRestToken> {
    try {
      return (await this.getToken("/oauth/token?grant_type=password", {
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
  public async refreshToken(token: IRestToken): Promise<IRestToken | false> {
    log(LogLevel.Trace, `refreshToken(${JSON.stringify(token)})`);

    if (typeof token !== "object") {
      throw new Error("invalid token");
    }
    assert(typeof token.refresh_token === "string");
    assert(token.refresh_token!.length === 64);

    if (!token.access_token || RestClient.tokenExpired(token)) {
      log(LogLevel.Debug, `token renewal (${JSON.stringify(token)})`);
      return (await this.getToken("/oauth/token", {
        grant_type: "refresh_token",
        client_id: config.TESLA_CLIENT_ID,
        client_secret: config.TESLA_CLIENT_SECRET,
        refresh_token: token.refresh_token
      })) as IRestToken;
    } else {
      return false;
    }
  }

  public async wakeUp(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/wake_up`,
      undefined,
      token
    );
    log(LogLevel.Trace, `wakeUp(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async setChargeLimit(id: string, limit: number, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/set_charge_limit`,
      { percent: limit },
      token
    );
    log(
      LogLevel.Trace,
      `setChargeLimit(${id}, ${limit}) => ${JSON.stringify(result)}`
    );
    return result;
  }
  public async chargeStart(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_start`,
      undefined,
      token
    );
    log(LogLevel.Trace, `chargeStart(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async chargeStop(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_stop`,
      undefined,
      token
    );
    log(LogLevel.Trace, `chargeStop(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async openChargePort(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_port_door_open`,
      undefined,
      token
    );
    log(LogLevel.Trace, `openChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async closeChargePort(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_port_door_close`,
      undefined,
      token
    );
    log(LogLevel.Trace, `closeChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOn(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_start`,
      undefined,
      token
    );
    log(LogLevel.Trace, `climateOn(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOff(id: string, token: IRestToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_stop`,
      undefined,
      token
    );
    log(LogLevel.Trace, `climateOff(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async listVehicle(id: string | undefined, token: IRestToken) {
    if (id === undefined) {
      return await this.get(`/api/1/vehicles`, token);
    } else {
      return await this.get(`/api/1/vehicles/${id}`, token);
    }
  }
  public async getVehicleData(id: string, token: IRestToken) {
    return await this.get(`/api/1/vehicles/${id}/vehicle_data`, token);
  }
}
const teslaAPI = new TeslaAPI({
  baseURL: config.TESLA_API_BASE_URL,
  agent: `${PROJECT_AGENT} ${provider.name}/${provider.version}`,
  timeout: 120e3
});
export default teslaAPI;
