import { IProviderServer } from "@providers/provider-servers";
import { IContext } from "server/gql-api";
import provider from "./index";
import { TeslaAgent } from "./tesla-agent";
import { IRestToken } from "@shared/restclient";
import { ApolloError } from "apollo-server-express";
import { DBInterface } from "server/db-interface";

export async function maintainToken(
  db: DBInterface,
  accountUUID: string,
  oldToken: IRestToken
): Promise<IRestToken> {
  try {
    const newToken = await TeslaAgent.maintainToken(oldToken);
    if (newToken) {
      await db.updateProviderData(
        accountUUID,
        undefined,
        "tesla",
        { token: { refresh_token: oldToken.refresh_token } },
        { token: newToken }
      );
      return newToken;
    } else {
      return oldToken;
    }
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
        return (await TeslaAgent.listVehicle(data.id, data.token)).response;
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
        try {
          const oldToken: IRestToken = data.token
            ? data.token
            : {
                access_token: data.refresh_token, // fake
                expires_at: 0,
                refresh_token: data.refresh_token
              };
          const newToken = await TeslaAgent.maintainToken(oldToken);
          if (newToken) {
            await context.db.updateProviderData(
              context.accountUUID,
              undefined,
              "tesla",
              { token: { refresh_token: oldToken.refresh_token } },
              { token: newToken }
            );
            return newToken;
          } else {
            return oldToken;
          }
        } catch (err) {
          throw new ApolloError("Invalid token", "INVALID_TOKEN");
        }
      }
      default:
        throw new Error(`Invalid query ${data.mutation} sent to tesla-server`);
    }
  }
};
export default server;
