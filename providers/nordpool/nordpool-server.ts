import provider from "./index";
import { IContext } from "@server/gql/api";
import { IProviderServer } from "@providers/provider-server";
import { DEFAULT_LOCATION_RADIUS } from "@shared/smartcharge-defines";

const server: IProviderServer = {
  ...provider,
  query: async (data: any, context: IContext) => {
    console.debug(data);
    switch (data.query) {
      case "areas": {
        return await context.db.pg.manyOrNone(
          `SELECT DISTINCT price_code, upper(substring(price_code,10)) as area FROM price_data WHERE price_code like 'nordpool.%';`
        );
      }
      default:
        throw new Error(`Invalid query ${data.query} sent to nordpool-server`);
    }
  },
  mutation: async (data: any, context: IContext) => {
    switch (data.mutation) {
      case "newLocation": {
        const location = context.db.newLocation(
          context.accountUUID,
          data.name,
          data.latitude * 1e6,
          data.longitude * 1e6,
          DEFAULT_LOCATION_RADIUS,
          data.price_code
          /*{
            provider: "nordpool",
            ...data.provider_data
          } as NordpoolProviderData*/
        );
        await context.logic.refreshChargePlan(undefined, context.accountUUID);
        return location;
      }
      default:
        throw new Error(
          `Invalid mutation ${data.mutation} sent to nordpool-server`
        );
    }
  }
};
export default server;
