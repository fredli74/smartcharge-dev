/* eslint-disable require-atomic-updates */
/**
 * @file NordpoolAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { SCClient } from "@shared/sc-client";
import { log, LogLevel } from "@shared/utils";
import {
  AgentJob,
  AbstractAgent,
  IProviderAgent,
  AgentAction
} from "@providers/provider-agent";
import provider, { NordpoolProviderData } from ".";
import config from "./nordpool-config";
import nordpoolAPI from "./nordpool-api";
import { UpdatePriceInput, LocationPrice } from "@server/gql/location-type";

interface NordpoolAgentSubject extends AgentJob {
  providerData: NordpoolProviderData;
  state: {};
}
debugger;
export class NordpoolAgent extends AbstractAgent {
  public name: string = provider.name;
  private polling: boolean = false;
  private nextUpdate: number = 0;
  private currency: string = "";
  constructor(scClient: SCClient) {
    super(scClient);
  }

  public newState() {
    return {};
  }

  public async [AgentAction.Update](
    job: NordpoolAgentSubject
  ): Promise<boolean> {
    const now = Date.now();
    if (!this.polling && now > this.nextUpdate) {
      this.polling = true;
      try {
        const res = await nordpoolAPI.getPrices(config.PAGE, config.CURRENCY);
        this.currency = res.currency;

        const areas: { [area: string]: LocationPrice[] } = {};
        // remap table
        for (const row of res.data.Rows) {
          if (row.IsExtraRow) continue;
          const startAt = new Date(row.StartTime + "+0200");
          for (const col of row.Columns) {
            if (!areas[col.Name]) {
              areas[col.Name] = [];
            }
            areas[col.Name].push({
              startAt,
              price: parseFloat(col.Value.replace(/,/g, ".")) / 1e3
            });
          }
        }

        for (const [area, prices] of Object.entries(areas)) {
          const update: UpdatePriceInput = {
            code: `${this.name}.${area}`.toLowerCase(),
            prices
          };
          log(
            LogLevel.Trace,
            `Sending updatePrice for ${update.code} => ${JSON.stringify(
              update
            )}`
          );
          await this.scClient.updatePrice(update);
        }

        this.nextUpdate = (Math.floor(now / 3600e3) + 1) * 3600e3 + 120e3;
      } finally {
        this.polling = false;
      }
    }

    if (
      this.currency && // means we ran once
      job.providerData.currency !== this.currency
    ) {
      job.providerData.currency = this.currency;
      await this.scClient.updateLocation({
        id: job.subjectID,
        providerData: { currency: job.providerData.currency }
      });
    }

    job.interval = Math.max(60, (this.nextUpdate - now) / 1e3);
    return true;
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new NordpoolAgent(scClient)
};
export default agent;
