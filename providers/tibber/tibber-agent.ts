/* eslint-disable require-atomic-updates */
/**
 * @file TibberAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient } from "@shared/restclient";
import { PROJECT_AGENT } from "@shared/smartcharge-globals.json";

import { SCClient } from "@shared/sc-client";
import { log, LogLevel } from "@shared/utils";
import { UpdatePriceInput } from "@shared/gql-types";
import {
  AgentJob,
  AbstractAgent,
  IProviderAgent,
  AgentAction
} from "@providers/provider-agent";
import provider, { TibberProviderData } from ".";
import config from "./tibber-config";
import tibberAPI from "./tibber-api";

interface TibberAgentSubject extends AgentJob {
  providerData: TibberProviderData;
  state: {};
}

interface PricePoint {
  total: number; //
  startsAt: string; //
  level: string; //
  currency: string; //
}

export class TibberAgent extends AbstractAgent {
  public name: string = provider.name;
  private tibberAPI: RestClient;
  constructor(scClient: SCClient) {
    super(scClient);
    // TODO replace with gql apollo client ?
    this.tibberAPI = new RestClient({
      baseURL: config.TIBBER_API_BASE_URL,
      agent: `${PROJECT_AGENT}`,
      timeout: 120000
    });
  }

  public newState() {
    return {};
  }

  public async [AgentAction.Update](job: TibberAgentSubject): Promise<boolean> {
    if (job.providerData.invalidToken) {
      return false;
    }

    const now = Date.now();
    const res = await tibberAPI.getPrices(
      job.providerData.home,
      job.providerData.token
    );
    if (
      res.errors &&
      res.errors.length > 0 &&
      res.errors[0].message.match(/No valid access token/)
    ) {
      await this.scClient.updateLocation({
        id: job.subjectID,
        providerData: { invalidToken: true }
      });
    } else {
      const priceInfo = res.data.viewer.home.currentSubscription.priceInfo;
      if (
        priceInfo.current &&
        priceInfo.current.currency &&
        job.providerData.currency !== priceInfo.current.currency
      ) {
        job.providerData.currency = priceInfo.current.currency;
        await this.scClient.updateLocation({
          id: job.subjectID,
          providerData: { currency: job.providerData.currency }
        });
      }
      const list: PricePoint[] = [].concat(priceInfo.today, priceInfo.tomorrow);
      assert(list.length > 0);
      const update: UpdatePriceInput = { id: job.subjectID, prices: [] };
      for (const p of list) {
        update.prices.push({ startAt: new Date(p.startsAt), price: p.total });
      }

      log(
        LogLevel.Trace,
        `Sending updatePrice for ${this.name}.${
          job.subjectID
        } => ${JSON.stringify(update)}`
      );
      await this.scClient.updatePrice(update);
      const ts = Math.trunc(now / 1e3); // epoch seconds
      job.interval = Math.trunc(ts / 3600 + 1) * 3600 - ts; // Run again next whole hour
    }
    return true;
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new TibberAgent(scClient)
};
export default agent;
