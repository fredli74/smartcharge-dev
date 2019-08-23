import { IContext } from "@server/gql/api";
import provider, {
  TeslaServiceData,
  TeslaProviderMutates,
  TeslaProviderQueries,
  TeslaProviderData
} from "./index";
import { IRestToken } from "@shared/restclient";
import { ApolloError } from "apollo-server-express";
import { DBInterface } from "@server/db-interface";
import teslaAPI from "./tesla-api";
import { log, LogLevel } from "@shared/utils";
import { IProviderServer } from "@providers/provider-server";
import { TeslaNewListEntry } from "./app/tesla-helper";
import config from "./tesla-config";

export async function maintainToken(
  db: DBInterface,
  accountUUID: string,
  oldToken: IRestToken
): Promise<IRestToken> {
  try {
    const newToken = await teslaAPI.maintainToken(oldToken);
    if (!newToken) {
      return oldToken;
    }
    const dblist = await db.pg.manyOrNone(
      `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $2) WHERE service_data @> $1 RETURNING *;`,
      [
        { token: { refresh_token: oldToken.refresh_token } },
        { token: newToken, invalid_token: null }
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
  query: async (data: any, context: IContext) => {
    console.debug(data);
    switch (data.query) {
      case TeslaProviderQueries.Vehicles: {
        if (data.token) {
          await context.db.pg.one(
            `INSERT INTO service_provider(account_uuid, provider_name, service_data)
            VALUES ($1,$2,$3) RETURNING *;`,
            [
              context.accountUUID,
              provider.name,
              { token: data.token, map: {} } as TeslaServiceData
            ]
          );
        }

        const vehicles = [];
        const serviceList = (await context.db.getServiceProviders(
          context.accountUUID,
          [provider.name]
        )) as {
          ownerID: string;
          providerName: string;
          serviceID: string;
          serviceData: TeslaServiceData;
        }[];
        for (const s of serviceList) {
          if (!s.serviceData.invalid_token && s.serviceData.token) {
            try {
              const list = (await teslaAPI.listVehicle(
                undefined,
                s.serviceData.token
              )).response;
              for (const l of list) {
                for (const t of serviceList) {
                  if (
                    t.serviceID !== s.serviceID &&
                    t.serviceData.map[l.id_s]
                  ) {
                    const vid = t.serviceData.map[l.id_s];
                    delete t.serviceData.map[l.id_s];

                    s.serviceData.map[l.id_s] = vid;

                    await context.db.pg.none(
                      `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $1)
                        WHERE service_uuid=$2;
                        UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $3)
                        WHERE service_uuid=$4;`,
                      [
                        { map: { [l.id_s]: null } },
                        t.serviceID,
                        { map: { [l.id_s]: vid } },
                        s.serviceID
                      ]
                    );
                  }
                }
                l.service_uuid = s.serviceID;
                l.controlled = s.serviceData.map[l.id_s] !== undefined;
              }
              vehicles.push(...list);
            } catch (err) {
              if (err.code === 401) {
                const dblist = await context.db.pg.manyOrNone(
                  `UPDATE service_provider SET data = jsonb_strip_nulls(data || $2) WHERE data @> $1 RETURNING *;`,
                  [
                    {
                      token: { access_token: s.serviceData.token.access_token }
                    },
                    { invalid_token: true }
                  ]
                );
                for (const v of dblist) {
                  log(
                    LogLevel.Info,
                    `Invalidating token for vehicle ${v.vehicle_uuid}`
                  );
                }
              }
            }
          }
        }
        return vehicles;
      }
      default:
        throw new Error(`Invalid query ${data.query} sent to tesla-server`);
    }
  },
  mutation: async (data: any, context: IContext) => {
    switch (data.mutation) {
      case TeslaProviderMutates.RefreshToken: {
        return await maintainToken(
          context.db,
          context.accountUUID,
          data.token ? data.token : { refresh_token: data.refresh_token }
        );
      }
      case TeslaProviderMutates.NewVehicle: {
        const input = data.input as TeslaNewListEntry;
        const vehicle = await context.db.newVehicle(
          context.accountUUID,
          input.name,
          config.DEFAULT_MINIMUM_LEVEL,
          config.DEFAULT_MAXIMUM_LEVEL,
          input.service_uuid,
          { provider: "tesla" } as TeslaProviderData
        );
        await context.db.pg.none(
          `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $1)
            WHERE service_uuid=$2;`,
          [{ map: { [input.id]: vehicle.vehicle_uuid } }, input.service_uuid]
        );
        return vehicle;
      }
      default:
        throw new Error(
          `Invalid mutation ${data.mutation} sent to tesla-server`
        );
    }
  }
};
export default server;
