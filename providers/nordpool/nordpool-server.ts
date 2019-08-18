import provider from "./index";
import { IContext } from "@server/gql/api";
import { IProviderServer } from "@providers/provider-server";

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
        throw new Error(`Invalid query ${data.query} sent to tesla-server`);
    }
  },
  mutation: async (data: any, _context: IContext) => {
    switch (data.mutation) {
      default:
        throw new Error(`Invalid query ${data.mutation} sent to tesla-server`);
    }
  }
};
export default server;
