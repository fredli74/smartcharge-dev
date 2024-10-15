/* eslint-disable require-atomic-updates */
/**
 * @file NordpoolAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { SCClient } from "@shared/sc-client";
import { log, LogLevel } from "@shared/utils";
import {
  AbstractAgent,
  IProviderAgent,
  AgentWork,
} from "@providers/provider-agent";
import provider from ".";
import config from "./nordpool-config";
import nordpoolAPI from "./nordpool-api";
import { DateTime } from "luxon";
import { GQLUpdatePriceInput } from "@shared/sc-schema";
import { v5 as uuidv5 } from "uuid";
import { RestClientError } from "@shared/restclient";

const NORDPOOL_NAMESPACE = uuidv5("agent.nordpool.smartcharge.dev", uuidv5.DNS);

export class NordpoolAgent extends AbstractAgent {
  public name: string = provider.name;
  constructor(scClient: SCClient) {
    super(scClient);
  }

  public newState() {
    return {};
  }

  private areaIDmap: Record<string, string> = {};
  private deliveryDate = DateTime.utc().startOf("day");

  public async globalWork(job: AgentWork) {
    const now = Date.now();

    try {
      const res:{
        updatedAt: string,
        multiAreaEntries: {
          deliveryStart: string,
          deliveryEnd: string,
          entryPerArea: Record<string, number>
        }[],
        areaStates: {
          state: string,
          areas: string[]
        }[]
      } = await nordpoolAPI.getPrices(this.deliveryDate.toISODate(), config.AREAS, config.CURRENCY);

      const areas: Record<string, GQLUpdatePriceInput> = {};

      // populate areas based on final areas
      for (const stateEntry of res.areaStates) {
        if (stateEntry.state === "Final") {
          for (const area of stateEntry.areas) {
            if (!areas[area]) {
              if (this.areaIDmap[area] === undefined) {
                const id = uuidv5(`${area}.pricelist`, NORDPOOL_NAMESPACE);
                try {
                  // Check that list exits on server
                  await this.scClient.getPriceList(id);
                } catch {
                  const list = await this.scClient.newPriceList(`EU.${area}`, true, id);
                  if (list.id !== id) {
                    throw "Unable to create price list on server";
                  }
                }
                this.areaIDmap[area] = id;
              }

              areas[area] = {
                priceListID: this.areaIDmap[area],
                prices: [],
              };
            }
          }
        }
      }

      // remap area prices to GQLUpdatePriceInput
      for (const entry of res.multiAreaEntries) {
        for (const [area, price] of Object.entries(entry.entryPerArea)) {
          if (areas[area]) {
            areas[area].prices.push({
              startAt: entry.deliveryStart,
              price: price / 1e3,
            });
          } else {
            log(LogLevel.Trace, `Unknown area ${area}`);
          }
        }
      }

      // Updating prices
      for (const [name, update] of Object.entries(areas)) {
        if (update.prices.length === 0) {
          log(LogLevel.Warning, `No prices for ${name}`);
          continue;
        }
        log(
          LogLevel.Trace,
          `Sending updatePrice for ${name} => ${JSON.stringify(update)}`
        );
        await this.scClient.updatePrice(update);
      }

      this.deliveryDate = this.deliveryDate.plus({ days: 1 });
      const updatedAt = DateTime.fromISO(res.updatedAt, { zone: "utc" });
      const nextUpdate = (updatedAt.plus({ hours: 22 }).startOf("hour").toMillis() + 60e3);
      job.interval = Math.max(60, (nextUpdate - now) / 1e3);

    } catch (e: any) {
      if (e instanceof RestClientError && e.code === 204) {
        // No content = no prices set yet
        log(LogLevel.Info, `No nordpool prices set for ${this.deliveryDate.toISODate()} yet, will try again next hour`);
        const nextUpdate = (Math.floor(now / 3600e3) + 1) * 3600e3 + 120e3;
        job.interval = Math.max(60, (nextUpdate - now) / 1e3);
      } else {
        log(LogLevel.Error, `Error fetching prices: ${e.message}, will retry in 15 minutes`);
        job.interval = 900;
      }
    }
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new NordpoolAgent(scClient),
};
export default agent;
