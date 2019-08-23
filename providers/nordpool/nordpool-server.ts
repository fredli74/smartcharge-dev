import provider, { NordpoolProviderData } from "./index";
import { IContext } from "@server/gql/api";
import { IProviderServer } from "@providers/provider-server";
import { GeoLocation } from "@server/gql/location-type";

const server: IProviderServer = {
  ...provider,
  query: async (data: any, context: IContext) => {
    console.debug(data);
    switch (data.query) {
      case "areas": {
        return await context.db.pg.manyOrNone(
          `SELECT DISTINCT price_code, upper(substring(price_code,10)) as area FROM price_list WHERE price_code like 'nordpool.%';`
        );
      }
      default:
        throw new Error(`Invalid query ${data.query} sent to nordpool-server`);
    }
  },
  mutation: async (data: any, context: IContext) => {
    switch (data.mutation) {
      case "newLocation": {
        return context.db.newLocation(
          context.accountUUID,
          data.name,
          { latitude: data.latitude, longitude: data.longitude } as GeoLocation,
          250,
          data.price_code,
          {
            provider: "nordpool",
            ...data.provider_data
          } as NordpoolProviderData
        );
      }
      default:
        throw new Error(
          `Invalid mutation ${data.mutation} sent to nordpool-server`
        );
    }
  }
};
export default server;
