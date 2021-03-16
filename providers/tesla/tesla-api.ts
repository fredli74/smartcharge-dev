/**
 * @file TeslaAPI helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { RestClient, RestClientError } from "@shared/restclient";
import config from "./tesla-config";
import { log, LogLevel, mergeURL } from "@shared/utils";
import provider, { TeslaToken } from ".";
import { PROJECT_AGENT } from "@shared/smartcharge-defines";

function time(): number {
  return Math.floor(new Date().valueOf() / 1e3);
}

export class TeslaAPI extends RestClient {
  public static tokenExpired(token: TeslaToken): boolean {
    return token.expires_at <= time();
  }

  /*
    Obsolete!
    Needs to be reimplemented with v3

    public async authenticate(
      email: string,
      password: string,
      mfa: string
    ): Promise<TeslaToken> {
      try {
        return (await this.getToken("/oauth/token?grant_type=password", {
          grant_type: "password",
          client_id: config.TESLA_CLIENT_ID,
          client_secret: config.TESLA_CLIENT_SECRET,
          email: email,
          password: password
        })) as TeslaToken;
      } catch (error) {
        log(
          LogLevel.Debug,
          `TeslaAgent.Authenticate error: ${error.data.response}`
        );
        throw error;
      }
    }
  */

  public async renewToken(refresh_token: string): Promise<TeslaToken> {
    try {
      log(LogLevel.Trace, `renewToken(${refresh_token})`);

      // Tesla authentication is multi layered at the moment
      // First you need to renew the new Tesla SSO access token by using
      // the refresh token from previous oauth2/v3 authorization
      const authResponse = (await this.post(
        mergeURL(config.TESLA_AUTH_BASE_URL, "token"),
        {
          grant_type: "refresh_token",
          scope: "openid email offline_access",
          client_id: "ownerapi",
          refresh_token: refresh_token
        }
      )) as any;
      if (typeof authResponse.access_token !== "string") {
        throw new RestClientError(
          `Error parsing Tesla oauth2 v3 token response, missing access_token ${JSON.stringify(
            authResponse
          )}`,
          500
        );
      }
      if (typeof authResponse.refresh_token !== "string") {
        throw new RestClientError(
          `Error parsing Tesla oauth2 v3 token response, missing refresh_token ${JSON.stringify(
            authResponse
          )}`,
          500
        );
      }

      // Use the bearer token to access owner-api and get a new access token
      const apiResponse = (await this.post(
        "/oauth/token",
        {
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          client_id: config.TESLA_CLIENT_ID,
          client_secret: config.TESLA_CLIENT_SECRET
        },
        authResponse.access_token
      )) as any;

      // Parse the token response
      const expires = Number.parseInt(apiResponse.expires_in);
      if (
        typeof apiResponse.access_token !== "string" ||
        !Number.isInteger(expires)
      ) {
        throw new RestClientError(
          `Error parsing invalid OAuth2.0 token response ${JSON.stringify(
            apiResponse
          )}`,
          500
        );
      }

      return {
        access_token: apiResponse.access_token,
        expires_at: time() + expires - config.TOKEN_EXPIRATION_WINDOW,
        refresh_token: authResponse.refresh_token
      };
    } catch (e) {
      console.debug(`TeslaAPI.renewToken error: ${e}`);
      throw e;
    }
  }

  public async wakeUp(id: string, token: TeslaToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/wake_up`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `wakeUp(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async setChargeLimit(id: string, limit: number, token: TeslaToken) {
    const result = await this.post(
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
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_start`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `chargeStart(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async chargeStop(id: string, token: TeslaToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_stop`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `chargeStop(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async openChargePort(id: string, token: TeslaToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_port_door_open`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `openChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async closeChargePort(id: string, token: TeslaToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/charge_port_door_close`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `closeChargePort(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOn(id: string, token: TeslaToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_start`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `climateOn(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async climateOff(id: string, token: TeslaToken) {
    const result = await this.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_stop`,
      undefined,
      token.access_token
    );
    log(LogLevel.Trace, `climateOff(${id}) => ${JSON.stringify(result)}`);
    return result;
  }
  public async listVehicle(id: string | undefined, token: TeslaToken) {
    if (id === undefined) {
      return await this.get(`/api/1/vehicles`, token.access_token);
    } else {
      return await this.get(`/api/1/vehicles/${id}`, token.access_token);
    }
  }
  public async getVehicleData(id: string, token: TeslaToken) {
    return await this.get(
      `/api/1/vehicles/${id}/vehicle_data`,
      token.access_token
    );
  }
}
const teslaAPI = new TeslaAPI({
  baseURL: config.TESLA_API_BASE_URL,
  agent: `curl/7.64.1`, // ${PROJECT_AGENT} ${provider.name}/${provider.version}`,
  proxy: config.TESLA_API_PROXY,
  timeout: 120e3
});
export default teslaAPI;
