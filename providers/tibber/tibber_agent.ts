/* eslint-disable require-atomic-updates */
/**
 * @file TibberAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient } from "@shared/restclient";
import { AbstractAgent, AgentJob } from "@shared/agent";
import { PROJECT_AGENT } from "@shared/smartcharge-globals";

import { SCClient } from "@shared/sc-client";
import { log, LogLevel } from "@shared/utils";
import { UpdatePriceInput } from "@shared/gql-types";

const APP_NAME = `TibberAgent`;
const APP_VERSION = `1.0`;

const AGENT_NAME = "tibber";

const TIBBER_API_BASE_URL = "https://api.tibber.com/v1-beta/gql";

interface TibberAgentSubject extends AgentJob {
  data: {
    token: string; // token for API authentication
    home: string; // tibber home id
    location: string; // smartcharge location uuid
    currency: string; // currency used for price points
  };
  state: {};
}

interface PricePoint {
  total: number; //
  startsAt: string; //
  level: string; //
  currency: string; //
}

export class TibberAgent extends AbstractAgent {
  public name: string = AGENT_NAME;
  private tibberAPI: RestClient;
  constructor(private scClient: SCClient) {
    super();
    // TODO replace with gql apollo client ?
    this.tibberAPI = new RestClient({
      baseURL: TIBBER_API_BASE_URL,
      agent: `${PROJECT_AGENT} ${APP_NAME}/${APP_VERSION}`,
      timeout: 120000
    });
  }

  public async work(job: TibberAgentSubject): Promise<number> {
    const now = Date.now();

    const res = await this.tibberAPI.post(
      "",
      {
        query:
          `{ viewer { home(id: "${job.data.home}") { currentSubscription { priceInfo { ` +
          `   current { currency } ` +
          `   today { total, startsAt, level, currency } ` +
          `   tomorrow { total, startsAt, level }` +
          `} } } } }`
      },
      job.data.token
    );
    const priceInfo = res.data.viewer.home.currentSubscription.priceInfo;
    if (
      priceInfo.current &&
      priceInfo.current.currency &&
      job.data.currency !== priceInfo.current.currency
    ) {
      job.data.currency = priceInfo.current.currency;
      await this.scClient.updateProvider({
        id: job.uuid,
        data: { currency: job.data.currency }
      });
      // await this.client.updateAgent()
      // await this.agentCallback(sub, { type: 'AgentUpdate', payload: { currency: sub.agent_data.currency } });
    }
    const list: PricePoint[] = [].concat(priceInfo.today, priceInfo.tomorrow);
    assert(list.length > 0);
    const update: UpdatePriceInput = { id: job.data.location, prices: [] };
    for (const p of list) {
      update.prices.push({ startAt: new Date(p.startsAt), price: p.total });
    }

    log(
      LogLevel.Trace,
      `Sending updatePrice for ${AGENT_NAME}.${
        job.data.location
      } => ${JSON.stringify(update)}`
    );
    await this.scClient.updatePrice(update);

    const ts = Math.trunc(now / 1e3); // epoch seconds
    return Math.trunc(ts / 3600 + 1) * 3600 - ts; // Run again next whole hour
  }
}
