/**
 * @file Nordpool API helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { RestClient } from "@shared/restclient";
import config from "./nordpool-config";
import provider from ".";
import { PROJECT_AGENT } from "@shared/smartcharge-defines";

export class NordpoolAPI extends RestClient {
  public async getPrices(page: number, currency: string) {
    // add &endDate=29-03-2020 if we need to poll historic data
    return this.get(
      `/marketdata/page/${page}?currency=${currency},${currency},EUR,EUR`
    );
  }
}
const nordpoolAPI = new NordpoolAPI({
  baseURL: config.NORDPOOL_API_BASE_URL,
  headers: {
    "User-Agent": `${PROJECT_AGENT} ${provider.name}/${provider.version}`,
  },
  timeout: 120e3,
});
export default nordpoolAPI;
