/**
 * @file GraphQL API Vehicle resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */
import { strict as assert } from "assert";

import { SubscriptionTopic } from "./subscription.js";
import {
  Arg,
  Resolver,
  Query,
  Ctx,
  Mutation,
  Subscription,
  PubSub,
  PubSubEngine,
  Root,
  Int,
  ID,
  GraphQLISODateTime,
} from "type-graphql";
import { accountFilter } from "./api.js";
import type { IContext } from "./api.js";
import { INTERNAL_SERVICE_UUID } from "@server/db-interface.js";
import {
  Vehicle,
  UpdateVehicleInput,
  VehicleLocationSettings,
  Schedule,
} from "./vehicle-type.js";
import { log, LogLevel, makePublicID } from "@shared/utils.js";
import { plainToInstance } from "class-transformer";
import { DBSchedule } from "@server/db-schema.js";
import { ScheduleType } from "@shared/sc-types.js";
import { GraphQLError } from "graphql";

interface VehicleSubscriptionPayload {
  account_uuid: string;
  vehicle_uuid: string;
}

async function refreshService(context: IContext, service_uuid: string | null | undefined) {
  if (service_uuid) {
    return context.db.pg.none(
      `UPDATE service_provider SET service_data = jsonb_set(service_data, '{updated}', $2) WHERE service_uuid = $1;`,
      [service_uuid, Date.now()]
    );
  }
}

@Resolver()
export class VehicleResolver {
  @Query((_returns) => [Vehicle])
  async vehicles(@Ctx() context: IContext): Promise<Vehicle[]> {
    const dblist = await context.db.getVehicles(accountFilter(context.accountUUID));
    return plainToInstance(Vehicle, dblist);
  }
  @Query((_returns) => Vehicle)
  async vehicle(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    return plainToInstance(
      Vehicle,
      await context.db.getVehicle(accountFilter(context.accountUUID), id)
    );
  }
  @Query((_returns) => Int, { nullable: true })
  async vehicleLimit(@Ctx() context: IContext): Promise<number> {
    const limit = await context.db.pg.oneOrNone(
      `SELECT value::int - (SELECT COUNT(*) FROM vehicle) as limit FROM setting WHERE key = 'vehicleLimit';`
    );
    return (limit && limit.limit) || null;
  }

  @Subscription((_returns) => Vehicle, {
    // TODO: convert this into a subscribe: using apolloPubSub
    topics: SubscriptionTopic.VehicleUpdate,
    filter: async ({ payload, args, context }) => {
      return (
        payload.vehicle_uuid === args.id &&
        (context.accountUUID === INTERNAL_SERVICE_UUID ||
          context.accountUUID === payload.account_uuid)
      );
    },
  })
  async vehicleSubscription(
    @Root() payload: VehicleSubscriptionPayload,
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    if (payload) {
      assert(payload.vehicle_uuid === id);
      assert(context.accountUUID === INTERNAL_SERVICE_UUID || context.accountUUID === payload.account_uuid);
      return plainToInstance(
        Vehicle,
        await context.db.getVehicle(
          accountFilter(payload.account_uuid),
          payload.vehicle_uuid
        )
      );
    } else {
      // This happens when called without websockets
      return plainToInstance(
        Vehicle,
        await context.db.getVehicle(accountFilter(context.accountUUID), id)
      );
    }
  }

  @Mutation((_returns) => Boolean)
  async removeVehicle(
    @Arg("id", (_type) => ID) id: string,
    @Arg("confirm") confirm: string,
    @Ctx() context: IContext
  ): Promise<Boolean> {
    // verify vehicle ownage
    log(LogLevel.Debug, `removeVehicle: ${JSON.stringify(id)}`);
    const vehicle = await context.db.getVehicle(accountFilter(context.accountUUID), id);

    const publicID = makePublicID(vehicle.vehicle_uuid);
    if (confirm.toLowerCase() !== publicID) {
      throw new GraphQLError("Incorrect confirmation code",
        undefined, undefined, undefined, undefined, undefined, { code: "BAD_USER_INPUT" }
      );
    }

    await context.db.removeVehicle(id);
    refreshService(context, vehicle.service_uuid);
    return true;
  }

  @Mutation((_returns) => Vehicle)
  async updateVehicle(
    @Arg("input") input: UpdateVehicleInput,
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<Vehicle> {
    // verify vehicle ownage
    log(LogLevel.Debug, `updateVehicle: ${JSON.stringify(input)}`);
    await context.db.getVehicle(accountFilter(context.accountUUID), input.id);

    // remap settings array to settings map
    const locationSettingsMap =
      input.locationSettings &&
      input.locationSettings.reduce(
        (map: any, obj: VehicleLocationSettings) => {
          map[obj.locationID] = {
            directLevel: obj.directLevel,
            goal: obj.goal,
          };
          return map;
        },
        {}
      );

    const result = await context.db.updateVehicle(input.id, {
      name: input.name,
      maximum_charge: input.maximumLevel,
      location_settings: locationSettingsMap,
      status: input.status,
      service_uuid: input.serviceID,
      provider_data: input.providerData,
    });
    refreshService(context, input.serviceID);

    if (input.maximumLevel !== undefined || input.locationSettings !== undefined) {
      await context.logic.refreshChargePlan(input.id);
    }
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
      vehicle_uuid: result.vehicle_uuid,
      account_uuid: result.account_uuid,
    });
    return result;
  }

  @Mutation((_returns) => Boolean)
  async removeSchedule(
    @Arg("id", (_type) => Int) id: number,
    @Arg("vehicleID", (_type) => ID) vehicleID: string,
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<boolean> {
    // verify vehicle ownage
    log(LogLevel.Debug, `removeSchedule: ${JSON.stringify(id)}`);
    const vehicle = await context.db.getVehicle(
      accountFilter(context.accountUUID),
      vehicleID
    );

    await context.db.removeSchedule(id, vehicle.vehicle_uuid);
    await context.logic.refreshChargePlan(vehicle.vehicle_uuid);
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
      vehicle_uuid: vehicle.vehicle_uuid,
      account_uuid: vehicle.account_uuid,
    });
    return true;
  }

  @Mutation((_returns) => [Schedule])
  async updateSchedule(
    @Arg("id", (_type) => Int, { nullable: true, defaultValue: undefined })
      id: number | undefined,
    @Arg("vehicleID", (_type) => ID) vehicleID: string,
    @Arg("type", (_type) => ScheduleType) type: ScheduleType,
    @Arg("level", (_type) => Int, { nullable: true })
      level: number | null,
    @Arg("time", (_type) => GraphQLISODateTime, { nullable: true })
      time: Date | null,
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<DBSchedule[]> {
    // verify vehicle ownage
    log(LogLevel.Debug, `updateSchedule: ${JSON.stringify(id)} ${JSON.stringify(vehicleID)}`);
    const vehicle = await context.db.getVehicle(accountFilter(context.accountUUID), vehicleID);

    await context.db.updateSchedule(
      id,
      vehicle.vehicle_uuid,
      type,
      level,
      time
    );
    await context.logic.refreshChargePlan(vehicle.vehicle_uuid);
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
      vehicle_uuid: vehicle.vehicle_uuid,
      account_uuid: vehicle.account_uuid,
    });
    return context.db.getSchedule(vehicle.vehicle_uuid);
  }
}
