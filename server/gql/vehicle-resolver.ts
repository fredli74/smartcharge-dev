/**
 * @file GraphQL API Vehicle resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
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
  VehicleLocationSettings,
  Schedule
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
    return plainToClass(Vehicle, dblist);
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
          map[obj.locationID] = {
            directLevel: obj.directLevel,
            goal: obj.goal
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
      provider_data: input.providerData
    });

    if (
      input.maximumLevel !== undefined ||
      input.locationSettings !== undefined ||
      input.schedule !== undefined
    ) {
      await context.logic.refreshChargePlan(input.id);
    }
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
      vehicle_uuid: result.vehicle_uuid,
      account_uuid: result.account_uuid
    });
    return result;
  }

  @Mutation(_returns => [Schedule])
  async replaceVehicleSchedule(
    @Arg("id") id: string,
    @Arg("oldSchedule", _type => [Schedule]) oldSchedule: Schedule[],
    @Arg("newSchedule", _type => [Schedule]) newSchedule: Schedule[],
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<Schedule[]> {
    function excludeNull(obj: any): any {
      return Object.entries(obj).reduce((r, [k, v]) => {
        if (v !== null) {
          r[k] = v;
        }
        return r;
      }, {} as any);
    }
    const oldArray = oldSchedule.map(f => excludeNull(f));
    const newArray = newSchedule.map(f => excludeNull(f));
    const oldPlain = oldArray.map(f => JSON.stringify(f));
    const newPlain = newArray.map(f => JSON.stringify(f));

    let result: Schedule[] = [];

    // Find all schedules that have been removed
    for (let i = 0; i < oldPlain.length; ++i) {
      if (newPlain.indexOf(oldPlain[i]) < 0) {
        result = await context.db.removeVehicleSchedule(id, oldArray[i]);
      }
    }
    for (let i = 0; i < newPlain.length; ++i) {
      if (oldPlain.indexOf(newPlain[i]) < 0) {
        result = await context.db.addVehicleSchedule(id, newArray[i]);
      }
    }

    await context.logic.refreshChargePlan(id);
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
      vehicle_uuid: id,
      account_uuid: context.accountUUID
    });

    console.debug(result);
    console.debug(result.map(f => plainToClass(Schedule, f)));
    return result;
  }
}
