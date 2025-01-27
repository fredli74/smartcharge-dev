import { accountFilter } from "@server/gql/api.js";
import type { IContext } from "@server/gql/api.js";
import provider, { TeslaProviderMutates, TeslaProviderQueries, TeslaProviderData, TeslaToken } from "./index.js";
import { DBInterface } from "@server/db-interface.js";
import teslaAPI, { TeslaAPI } from "./tesla-api.js";
import { log, LogLevel } from "@shared/utils.js";
import { IProviderServer } from "@providers/provider-server.js";
import { TeslaNewListEntry } from "./app/tesla-helper.js";
import config from "./tesla-config.js";
import { DBServiceProvider } from "@server/db-schema.js";
import { strict as assert } from "assert";
import { GraphQLError } from "graphql";

export async function authorize(
  db: DBInterface,
  code: string,
  callbackURI: string
): Promise<TeslaToken> {
  try {
    log(LogLevel.Trace, `authorize(${code}, ${callbackURI})`);
    return await teslaAPI.authorize(code, callbackURI);
  } catch (err) {
    log(LogLevel.Error, err);
    throw new GraphQLError("Invalid token",
      undefined, undefined, undefined, undefined, undefined, { code: "INVALID_TOKEN" }
    );
  }
}

export async function maintainServiceToken(
  db: DBInterface,
  service: DBServiceProvider
): Promise<TeslaToken | null> {
  log(LogLevel.Trace, `maintainServiceToken for ${service.service_uuid}`);
  if (
    service.service_data.token !== undefined &&
    service.service_data.token.access_token !== undefined &&
    service.service_data.token.expires_at !== undefined &&
    !TeslaAPI.tokenExpired(service.service_data.token as TeslaToken)
  ) {
    log(LogLevel.Trace, `Token ${service.service_data.token.access_token} is still valid`);
    return service.service_data.token as TeslaToken;
  }

  assert(service.service_data.token.refresh_token);

  // Flag in database that we are refreshing the token and only one thread should do it
  const updateService = await db.pg.oneOrNone(
    `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $2) WHERE service_uuid=$1 AND NOT (service_data ? 'renewing_token') RETURNING *;`,
    [service.service_uuid, { updated: Date.now(), renewing_token: Date.now() }]
  );
  // If we got a row back, we are the only thread that is refreshing the token
  if (updateService) {
    log(LogLevel.Debug, `Token ${service.service_data.token.access_token} is expired, calling renewToken`);
    try {
      const newToken = await teslaAPI.renewToken(service.service_data.token.refresh_token);
      // Update the token in the database
      log(LogLevel.Trace, `Token ${service.service_data.token.access_token} renewed to ${newToken.access_token}`);
      log(LogLevel.Info, `Updating service_provider ${service.service_uuid} with new token`);
      await db.pg.none(
        `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $2) WHERE service_uuid=$1;
         UPDATE vehicle SET provider_data = jsonb_strip_nulls(provider_data || $3) WHERE service_uuid=$1;`,
        [
          service.service_uuid,
          {
            updated: Date.now(),
            token: newToken,
            renewing_token: null,
            invalid_token: null,
          },
          { invalid_token: null },
        ]
      );
      return newToken;
    } catch (err: any) {
      if (err && (err.message === "login_required" || err.message === "server_error")) {
        log(LogLevel.Warning, `Refresh token ${service.service_data.token.refresh_token} is invalid (${err.message})`);
        log(LogLevel.Info, `Setting service_provider ${service.service_uuid} as invalid token status`);
        await db.pg.none(
          `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $2) WHERE service_uuid=$1;
           UPDATE vehicle SET provider_data = jsonb_strip_nulls(provider_data || $3) WHERE service_uuid=$1;`,
          [
            service.service_uuid,
            { updated: Date.now(), invalid_token: true, renewing_token: null },
            { invalid_token: true },
          ]
        );
      } else {
        await db.pg.none(
          `UPDATE service_provider SET service_data = jsonb_strip_nulls(service_data || $2) WHERE service_uuid=$1;`,
          [service.service_uuid, { updated: Date.now(), renewing_token: null }]
        );
        log(LogLevel.Error, `Unexpected error raised when renewing token ${JSON.stringify(err)}`);
      }
      throw new GraphQLError("Invalid token",
        undefined, undefined, undefined, undefined, undefined, { code: "INVALID_TOKEN" }
      );
    }
  } else {
    log(LogLevel.Debug, `Token ${service.service_data.token.access_token} is already being refreshed, ignoring`);
    return null;
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
              { token: data.token, updated: Date.now() },
            ]
          );
        }

        const vehicles = [];
        const serviceList = await context.db.getServiceProviders(
          accountFilter(context.accountUUID),
          data.service_uuid,
          [provider.name]
        );

        const controlled = (
          await context.db.getVehicles(accountFilter(context.accountUUID))
        ).reduce((a, v) => {
          const provider_data = v.provider_data as unknown as TeslaProviderData;
          if (provider_data && provider_data.provider === "tesla" && provider_data.vin) {
            a[provider_data.vin] = v;
          }
          return a;
        }, {} as any);
        const mapped: any = {};

        for (const s of serviceList) {
          if (!s.service_data.invalid_token && s.service_data.token) {
            const token = await maintainServiceToken(context.db, s);
            if (!token) {
              continue;
            }
            try {
              const list: any[] = (await teslaAPI.listVehicle(undefined, token))
                .response;

              // Add everything that should be controlled
              for (const l of list) {
                const vin = l.vin;

                mapped[vin] = mapped[vin] || s.service_uuid;
                l.service_uuid = mapped[vin];

                const vehicle = controlled[vin];
                if (vehicle) {
                  l.vehicle_uuid = vehicle.vehicle_uuid;
                  l.display_name = vehicle.name || vin;
                  if (vehicle.service_uuid !== l.service_uuid) {
                    // Wrong service_uuid in database
                    vehicle.service_uuid = l.service_uuid;
                    await context.db.pg.none(
                      `UPDATE vehicle SET service_uuid=$1, provider_data = provider_data - 'invalid_token' WHERE vehicle_uuid=$2;
                       UPDATE service_provider SET service_data = jsonb_merge(service_data, $3) WHERE service_uuid=$1;`,
                      [
                        vehicle.service_uuid,
                        vehicle.vehicle_uuid,
                        { updated: Date.now() },
                        // TODO: updated should be a DB field instead
                      ]
                    );
                    log(LogLevel.Info, `Set service_uuid on ${vin}:${vehicle.vehicle_uuid} to ${vehicle.service_uuid}`);
                  }
                }
              }
              vehicles.push(...list);
            } catch (err: any) {
              log(LogLevel.Error, err);
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
      case TeslaProviderMutates.Authorize: {
        return await authorize(context.db, data.code, data.callbackURI);
      }
      case TeslaProviderMutates.RefreshToken: {
        log(LogLevel.Trace, `TeslaProviderMutates.RefreshToken ${JSON.stringify(data)}`);
        if (!data.service_uuid) {
          throw new GraphQLError("Invalid call to RefreshToken",
            undefined, undefined, undefined, undefined, undefined, { code: "BAD_USER_INPUT" }
          );
        }
        const service = await context.db.pg.oneOrNone(
          `SELECT * FROM service_provider WHERE service_uuid=$1;`,
          [data.service_uuid]
        );
        if (!service) {
          throw new GraphQLError("Service not found",
            undefined, undefined, undefined, undefined, undefined, { code: "BAD_USER_INPUT" }
          );
        }
        if (!service.service_data.token) {
          throw new GraphQLError("Service does not have a token",
            undefined, undefined, undefined, undefined, undefined, { code: "INVALID_TOKEN" }
          );
        }
        return await maintainServiceToken(context.db, service);
      }
      case TeslaProviderMutates.NewVehicle: {
        const input = data.input as TeslaNewListEntry;
        log(LogLevel.Trace, `TeslaProviderMutates.NewVehicle(${JSON.stringify(input)})`);
        if (context.accountUUID === undefined) {
          throw new GraphQLError("No accountUUID in context",
            undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
          );
        }
        const vehicle = await context.db.newVehicle(
          context.accountUUID,
          input.name,
          parseInt(config.DEFAULT_MAXIMUM_LEVEL),
          input.service_uuid,
          { provider: "tesla", vin: input.vin } as TeslaProviderData
        );
        log(
          LogLevel.Trace,
          `context.db.newVehicle returned ${JSON.stringify(vehicle)})`
        );
        await context.db.pg.none(
          `UPDATE service_provider SET service_data = jsonb_merge(service_data, $1)
           WHERE service_uuid=$2;`,
          [{ updated: Date.now() }, input.service_uuid]
        );
        return vehicle;
      }
      default:
        throw new Error(`Invalid mutation ${data.mutation} sent to tesla-server`);
    }
  },
};
export default server;
