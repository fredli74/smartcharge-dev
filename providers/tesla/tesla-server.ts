import { IProviderServer } from "@providers/provider-servers";
import { IContext } from "server/gql-api";
import provider from "./index";
import { IRestToken } from "@shared/restclient";
import { ApolloError } from "apollo-server-express";
import { DBInterface } from "server/db-interface";
import { TeslaAPI } from "./tesla-api";
import { log, LogLevel } from "@shared/utils";

export async function maintainToken(
  db: DBInterface,
  accountUUID: string,
  oldToken: IRestToken
): Promise<IRestToken> {
  try {
    const newToken = await TeslaAPI.maintainToken(oldToken);
    if (!newToken) {
      return oldToken;
    }
    const dblist = await db.pg.manyOrNone(
      `UPDATE vehicle SET provider_data = jsonb_strip_nulls(provider_data || $2) WHERE provider_data @> $1 RETURNING *;`,
      [
        { token: { refresh_token: oldToken.refresh_token } },
        { token: newToken }
      ]
    );
    for (const v of dblist) {
      log(
        LogLevel.Info,
        `Updating Tesla API token on vehicle ${v.vehicle_uuid}`
      );
    }
    return newToken;
  } catch (err) {
    throw new ApolloError("Invalid token", "INVALID_TOKEN");
  }
}

const server: IProviderServer = {
  ...provider,
  query: async (data: any, _context: IContext) => {
    console.debug(data);
    switch (data.query) {
      case "vehicles": {
        try {
          return (await TeslaAPI.listVehicle(data.id, data.token)).response;
        } catch (err) {
          debugger;
          console.debug("!!!!!!!!!!!!! TODO : INVALIDATE TOKEN !!!!!!!!!!!!!");
          throw err;
        }
      }
      default:
        throw new Error(`Invalid query ${data.query} sent to tesla-server`);
    }
  },
  mutation: async (data: any, context: IContext) => {
    debugger;
    console.debug(data);
    switch (data.mutation) {
      case "refreshToken": {
        return await maintainToken(
          context.db,
          context.accountUUID,
          data.token ? data.token : { refresh_token: data.refresh_token }
        );
      }
      default:
        throw new Error(`Invalid query ${data.mutation} sent to tesla-server`);
    }
  }
};
export default server;
