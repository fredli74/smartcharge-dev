/**
 * @file GraphQL API Vehicle resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
import { strict as assert } from "assert";

import { SubscriptionTopic } from "./subscription";
import {
  Arg,
  Resolver,
  Query,
  Ctx,
  Mutation,
  Subscription,
  PubSub,
  PubSubEngine,
  Root
} from "type-graphql";
import { IContext, accountFilter } from "./api";
import { INTERNAL_SERVICE_UUID } from "@server/db-interface";
import {
  Vehicle,
  UpdateVehicleInput,
  VehicleLocationSettings
} from "./vehicle-type";
import { log, LogLevel, makePublicID } from "@shared/utils";
import { ApolloError } from "apollo-server-core";
import { plainToClass } from "class-transformer";

interface VehicleSubscriptionPayload {
  account_uuid: string;
  vehicle_uuid: string;
}

@Resolver()
export class VehicleResolver {
  @Query(_returns => [Vehicle])
  async vehicles(@Ctx() context: IContext): Promise<Vehicle[]> {
    const dblist = await context.db.getVehicles(
      accountFilter(context.accountUUID)
    );
    return dblist.map(f => plainToClass(Vehicle, f));
  }
  @Query(_returns => Vehicle)
  async vehicle(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    return plainToClass(
      Vehicle,
      await context.db.getVehicle(accountFilter(context.accountUUID), id)
    );
  }

  @Subscription(_returns => Vehicle, {
    // TODO: convert this into a subscribe: using apolloPubSub
    topics: SubscriptionTopic.VehicleUpdate,
    filter: async ({ payload, args, context }) => {
      return (
        payload.vehicle_uuid === args.id &&
        (context.accountUUID === INTERNAL_SERVICE_UUID ||
          context.accountUUID === payload.account_uuid)
      );
    }
  })
  async vehicleSubscription(
    @Root() payload: VehicleSubscriptionPayload,
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    if (payload) {
      assert(payload.vehicle_uuid === id);
      assert(
        context.accountUUID === INTERNAL_SERVICE_UUID ||
          context.accountUUID === payload.account_uuid
      );
      return plainToClass(
        Vehicle,
        await context.db.getVehicle(
          accountFilter(payload.account_uuid),
          payload.vehicle_uuid
        )
      );
    } else {
      // This happens when called without websockets
      return plainToClass(
        Vehicle,
        await context.db.getVehicle(accountFilter(context.accountUUID), id)
      );
    }
  }

  @Mutation(_returns => Boolean)
  async removeVehicle(
    @Arg("id") id: string,
    @Arg("confirm") confirm: string,
    @Ctx() context: IContext
  ): Promise<Boolean> {
    // verify vehicle ownage
    log(LogLevel.Debug, `removeVehicle: ${JSON.stringify(id)}`);
    const vehicle = await context.db.getVehicle(
      accountFilter(context.accountUUID),
      id
    );

    const publicID = makePublicID(vehicle.vehicle_uuid);
    if (confirm.toLowerCase() !== publicID) {
      throw new ApolloError("Incorrect confirmation code");
    }

    await context.db.removeVehicle(id);
    return true;
  }

  @Mutation(_returns => Vehicle)
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
          map[obj.location] = {
            directLevel: obj.directLevel,
            goal: obj.goal
          };
          return map;
        },
        {}
      );

    const result = await context.db.updateVehicle(
      input.id,
      input.name,
      input.maximumLevel,
      locationSettingsMap,
      input.anxietyLevel,
      input.tripSchedule,
      input.pausedUntil,
      input.status,
      input.serviceID,

      input.providerData
    );

    if (
      input.maximumLevel !== undefined ||
      input.locationSettings !== undefined ||
      input.anxietyLevel !== undefined ||
      input.tripSchedule !== undefined
    ) {
      await context.logic.refreshChargePlan(input.id);
    }
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
      vehicle_uuid: result.vehicle_uuid,
      account_uuid: result.account_uuid
    });
    return result;
  }
}
