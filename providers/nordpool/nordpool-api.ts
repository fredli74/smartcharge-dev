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
  public async getPrices(date: string, deliveryArea: string, currency: string) {
    return this.get(
      `/DayAheadPrices?date=${date}&market=DayAhead&deliveryArea=${deliveryArea}&currency=${currency}`
    );
  }
}
const nordpoolAPI = new NordpoolAPI({
  baseURL: config.NORDPOOL_API_BASE_URL,
  headers: {
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36`,
  },
  timeout: 120e3,
});
export default nordpoolAPI;
