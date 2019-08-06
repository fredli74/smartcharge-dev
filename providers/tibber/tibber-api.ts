/**
 * @file Tibber API helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient, RestToken } from "@shared/restclient";
import { PROJECT_AGENT } from "@shared/smartcharge-globals";
import config from "./tibber-config";
import provider from ".";

/*

  TODO: Replace all of this with a proper GQL client instead?

*/

export class TibberAPI extends RestClient {
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

  public async getPrices(id: string, token: RestToken) {
    assert(id.length === 36);
    assert(typeof token === "string");
    assert((token as string).length === 64);
    return this.post(
      "",
      {
        query:
          `{ viewer { home(id: "${id}") { currentSubscription { priceInfo { ` +
          `   current { currency } ` +
          `   today { total, startsAt, level, currency } ` +
          `   tomorrow { total, startsAt, level }` +
          `} } } } }`
      },
      token
    );
  }
}
const tibberAPI = new TibberAPI({
  baseURL: config.TIBBER_API_BASE_URL,
  agent: `${PROJECT_AGENT} ${provider.name}/${provider.version}`,
  timeout: 120000
});
export default tibberAPI;
