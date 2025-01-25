/* eslint-disable require-atomic-updates */
/**
 * @file NordpoolAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { SCClient } from "@shared/sc-client.js";
import { log, LogLevel } from "@shared/utils.js";
import { AbstractAgent, IProviderAgent, AgentWork, } from "@providers/provider-agent.js";
import provider from "./index.js";
import config from "./nordpool-config.js";
import nordpoolAPI from "./nordpool-api.js";
import { DateTime } from "luxon";
import { GQLUpdatePriceInput } from "@shared/sc-schema.js";
import { v5 as uuidv5 } from "uuid";
import { RestClientError } from "@shared/restclient.js";

const NORDPOOL_NAMESPACE = uuidv5("agent.nordpool.smartcharge.dev", uuidv5.DNS);

interface PollResult {
  date: DateTime;
  updatedAt: DateTime;
  allFinal: boolean;
}

export class NordpoolAgent extends AbstractAgent {
  public name: string = provider.name;
  constructor(scClient: SCClient) { super(scClient); }

  public newState() {
    return {};
  }

  private areaIDmap: Record<string, string> = {};
  private todaysPollResult: PollResult | undefined;
  private tomorrowsPollResult: PollResult | undefined;

  public async pollDate(pollDate: DateTime): Promise<PollResult | undefined> {
    const pollDateString = pollDate.toISODate();
    try {
      const res: {
        updatedAt: string;
        multiAreaEntries: {
          deliveryStart: string; // "2024-12-31T00:00:00Z"
          deliveryEnd: string; // "2024-12-31T01:00:00Z"
          entryPerArea: Record<string, number>; // "SE1": 420.69
        }[];
        areaStates: {
          state: string;
          areas: string[];
        }[];
      } = await nordpoolAPI.getPrices(pollDateString, config.AREAS, config.CURRENCY);

      const areas: Record<string, GQLUpdatePriceInput> = {};
      const areaStates: Record<string, string> = {};

      // Build a list of area states
      for (const stateEntry of res.areaStates) {
        for (const area of stateEntry.areas) {
          areaStates[area] = stateEntry.state;
        }
        if (stateEntry.state !== "Final") {
          log(LogLevel.Debug, `Area state not final: ${JSON.stringify(stateEntry)}`);
        }
      }

      // Go through prices and populate updatePriceInputs
      let maxPrice = 0;
      for (const entry of res.multiAreaEntries) {
        for (const [area, price] of Object.entries(entry.entryPerArea)) {
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
          areas[area].prices.push({
            startAt: entry.deliveryStart,
            price: price / 1e3,
          });
          if (price > maxPrice) {
            maxPrice = price;
          }
        }
      }

      // Send updates to server
      let allFinal = true;
      const serverUpdates: Promise<boolean>[] = [];
      for (const [name, update] of Object.entries(areas)) {
        if (update.prices.length === 0) {
          log(LogLevel.Warning, `No prices for ${name}`);
          continue;
        }
        log(
          LogLevel.Info,
          `Sending ${areaStates[
            name
          ].toLowerCase()} updatePrice for ${name} => ${JSON.stringify(update)}`
        );
        if (areaStates[name] !== "Final") {
          allFinal = false;
        }
        serverUpdates.push(this.scClient.updatePrice(update));

        {
          // Temporary hack for Ellevio customers that has peak penalty
          // Copy areas[*] to list.id with Ellevio.* and set price for 06:00-22:00 (CET/CEST) to max(420.69, maxPrice)
          // This is to avoid charging during peak hours
          const ellevioArea = `Ellevio.${name}`;
          if (this.areaIDmap[ellevioArea] === undefined) {
            const id = uuidv5(`${ellevioArea}.pricelist`, NORDPOOL_NAMESPACE);
            try {
              await this.scClient.getPriceList(id);
            } catch {
              const list = await this.scClient.newPriceList(ellevioArea, true, id);
              if (list.id !== id) {
                throw "Unable to create price list on server";
              }
            }
            this.areaIDmap[ellevioArea] = id;
          }
          const ellevioUpdate: GQLUpdatePriceInput = {
            priceListID: this.areaIDmap[ellevioArea],
            prices: [],
          };
          for (const entry of update.prices) {
            const localStartAt = DateTime.fromISO(entry.startAt, { zone: "utc", }).setZone("Europe/Stockholm");
            ellevioUpdate.prices.push({
              startAt: entry.startAt,
              price: localStartAt.hour >= 6 && localStartAt.hour < 22
                ? Math.max(4.2, (maxPrice * 1.5) / 1e3)
                : entry.price,
            });
          }
          log(LogLevel.Info, `Sending ${areaStates[name].toLowerCase()} updatePrice for ${ellevioArea} => ${JSON.stringify(ellevioUpdate)}`
          );
          serverUpdates.push(this.scClient.updatePrice(ellevioUpdate));
        }
      }
      await Promise.all(serverUpdates);

      const updatedAt = DateTime.fromISO(res.updatedAt, { zone: "utc" });
      if (allFinal) {
        log(LogLevel.Info, `All areas were final for ${pollDateString}, last update at ${updatedAt.toISO()}`);
      } else {
        log(LogLevel.Info, `Some areas were not final for ${pollDateString}, will poll again`);
      }
      return { date: pollDate, updatedAt, allFinal };
    } catch (e: any) {
      if (e instanceof RestClientError && e.code === 204) {
        // No content = no prices set yet
        log(LogLevel.Info, `No nordpool prices set for ${pollDateString} yet, will poll again`);
      } else {
        log(LogLevel.Error, `Error fetching prices: ${e.message}`);
      }
    }
    return undefined;
  }

  public async globalWork(job: AgentWork) {
    const now = Date.now();

    const today = DateTime.utc().startOf("day");
    if (this.todaysPollResult !== undefined && +this.todaysPollResult.date !== +today) {
      this.todaysPollResult = this.tomorrowsPollResult;
      this.tomorrowsPollResult = undefined;
    }

    if (this.todaysPollResult === undefined || +this.todaysPollResult.date !== +today || !this.todaysPollResult.allFinal) {
      log(LogLevel.Debug, `Polling for ${today.toISODate()} because last poll for today was ${JSON.stringify(this.todaysPollResult)}`);
      this.todaysPollResult = await this.pollDate(today);
    }
    if (this.todaysPollResult === undefined) {
      job.interval = 3600;
      return;
    }

    const tomorrow = today.plus({ days: 1 });
    if (this.tomorrowsPollResult === undefined || +this.tomorrowsPollResult.date !== +tomorrow || !this.tomorrowsPollResult.allFinal) {
      log(LogLevel.Debug, `Polling for ${tomorrow.toISODate()} because last poll for tomorrow was ${JSON.stringify(this.tomorrowsPollResult)}`);
      this.tomorrowsPollResult = await this.pollDate(tomorrow);
    }
    if (this.tomorrowsPollResult === undefined) {
      job.interval = 3600;
      return;
    }

    if (this.tomorrowsPollResult.allFinal) {
      // We have prices for today and tomorrow, set next poll to 22 hours after tomorrows update
      const nextUpdate = this.tomorrowsPollResult.updatedAt
        .plus({ hours: 22 })
        .startOf("hour")
        .toMillis() + 60e3;
      log(LogLevel.Info, `Scheduling next update at ${new Date(nextUpdate).toISOString()}`);
      job.interval = Math.max(60, (nextUpdate - now) / 1e3);
    } else {
      log(LogLevel.Debug, `Not all areas were final for tomorrow, will poll again`);
      job.interval = 3600;
    }
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new NordpoolAgent(scClient),
};
export default agent;
