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
  AgentJob,
  AbstractAgent,
  IProviderAgent,
  AgentWork
} from "@providers/provider-agent";
import provider, { NordpoolServiceData } from ".";
import config from "./nordpool-config";
import nordpoolAPI from "./nordpool-api";
import { DateTime } from "luxon";
import { GQLUpdatePriceInput } from "@shared/sc-schema";
import { v5 as uuidv5 } from "uuid";

const NORDPOOL_NAMESPACE = uuidv5("agent.nordpool.smartcharge.dev", uuidv5.DNS);

interface NordpoolAgentJob extends AgentJob {
  serviceData: NordpoolServiceData;
  state: {};
}

export class NordpoolAgent extends AbstractAgent {
  public name: string = provider.name;
  constructor(scClient: SCClient) {
    super(scClient);
  }

  public newState() {
    return {};
  }

  private areaIDmap: Record<string, string> = {};

  public async globalWork(job: AgentWork) {
    const now = Date.now();
    const res = await nordpoolAPI.getPrices(config.PAGE, config.CURRENCY);

    const areas: Record<string, GQLUpdatePriceInput> = {};

    // remap table
    for (const row of res.data.Rows) {
      if (row.IsExtraRow) continue;
      const startAt = DateTime.fromISO(row.StartTime, {
        zone: "Europe/Oslo"
      }).toISO();
      for (const col of row.Columns) {
        const price = parseFloat(col.Value.replace(/,/g, ".")) / 1e3;
        if (!isNaN(price)) {
          if (!areas[col.Name]) {
            if (this.areaIDmap[col.Name] === undefined) {
              const id = uuidv5(`${col.Name}.pricelist`, NORDPOOL_NAMESPACE);
              try {
                // Check that list exits on server
                await this.scClient.getPriceList(id);
              } catch {
                const list = await this.scClient.newPriceList(
                  `EU.${col.Name}`,
                  true,
                  id
                );
                if (list.id !== id) {
                  throw "Unable to create price list on server";
                }
              }
              this.areaIDmap[col.Name] = id;
            }

            areas[col.Name] = {
              priceListID: this.areaIDmap[col.Name],
              prices: []
            };
          }
          areas[col.Name].prices.push({
            startAt,
            price: price
          });
        }
      }
    }

    for (const [name, update] of Object.entries(areas)) {
      log(
        LogLevel.Trace,
        `Sending updatePrice for ${name} => ${JSON.stringify(update)}`
      );
      await this.scClient.updatePrice(update);
    }

    const nextUpdate = (Math.floor(now / 3600e3) + 1) * 3600e3 + 120e3;
    job.interval = Math.max(60, (nextUpdate - now) / 1e3);
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new NordpoolAgent(scClient)
};
export default agent;
