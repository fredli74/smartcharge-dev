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
import { GQLLocationPrice, GQLUpdatePriceInput } from "@shared/sc-schema";

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

  public async globalWork(job: AgentWork) {
    const now = Date.now();
    const res = await nordpoolAPI.getPrices(config.PAGE, config.CURRENCY);

    const areas: { [area: string]: GQLLocationPrice[] } = {};
    // remap table
    for (const row of res.data.Rows) {
      if (row.IsExtraRow) continue;
      const startAt = DateTime.fromISO(row.StartTime, {
        zone: "Europe/Oslo"
      }).toJSDate();
      for (const col of row.Columns) {
        const price = parseFloat(col.Value.replace(/,/g, ".")) / 1e3;
        if (!isNaN(price)) {
          if (!areas[col.Name]) {
            areas[col.Name] = [];
          }
          areas[col.Name].push({
            startAt,
            price: price
          });
        }
      }
    }

    for (const [area, prices] of Object.entries(areas)) {
      const update: GQLUpdatePriceInput = {
        code: `${this.name}.${area}`.toLowerCase(),
        prices
      };
      log(
        LogLevel.Trace,
        `Sending updatePrice for ${update.code} => ${JSON.stringify(update)}`
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
