/**
 * @file Nordpool API helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient, RestToken } from "@shared/restclient";
import { PROJECT_AGENT } from "@shared/smartcharge-globals.json";
import config from "./nordpool-config";
import provider from ".";

export class NordpoolAPI extends RestClient {
  public async getHomes(token: RestToken) {
    assert(typeof token === "string");
    assert((token as string).length === 64);
    return this.post(
      "",
      {
        query: `{ viewer { homes { id appNickname } } }`
      },
      token
    );
  }

  public async getPrices(page: number, currency: string) {
    return this.get(
      `/marketdata/page/${page}?currency=${currency},${currency},EUR,EUR`
    );
  }
}
const nordpoolAPI = new NordpoolAPI({
  baseURL: config.NORDPOOL_API_BASE_URL,
  agent: `${PROJECT_AGENT} ${provider.name}/${provider.version}`,
  timeout: 120000
});
export default nordpoolAPI;
