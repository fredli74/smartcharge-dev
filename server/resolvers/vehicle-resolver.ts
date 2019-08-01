/**
 * @file Vehicle API resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

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
  Args
} from "type-graphql";
import { IContext } from "../gql-api";
import {
  Vehicle,
  UpdateVehicleInput,
  UpdateVehicleDataInput,
  VehicleDebugInput,
  NewVehicleInput
} from "@shared/gql-types";
import { DBInterface, INTERNAL_SERVICE_UUID } from "../db-interface";

const VehicleSubscriptionTopic = "VEHICLE_UPDATE";
interface VehicleSubscriptionPayload {
  account_uuid: string;
  vehicle_uuid: string;
}

@Resolver()
export class VehicleResolver {
  @Query(_returns => [Vehicle])
  async vehicles(@Ctx() context: IContext): Promise<Vehicle[]> {
    const dblist = await context.db.getVehicles(context.accountUUID);
    return dblist.map(DBInterface.DBVehicleToVehicle);
  }
  @Query(_returns => Vehicle)
  async vehicle(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    return DBInterface.DBVehicleToVehicle(
      await context.db.getVehicle(id, accountLimiter)
    );
  }

  @Subscription(_returns => Vehicle, {
    topics: VehicleSubscriptionTopic,
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
    assert(payload.vehicle_uuid === id);
    assert(
      context.accountUUID === INTERNAL_SERVICE_UUID ||
        context.accountUUID === payload.account_uuid
    );
    return DBInterface.DBVehicleToVehicle(
      await context.db.getVehicle(payload.vehicle_uuid, payload.account_uuid)
    );
  }

  @Mutation(_returns => Vehicle)
  async newVehicle(
    @Arg("input") input: NewVehicleInput,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    return DBInterface.DBVehicleToVehicle(
      await context.db.newVehicle(
        context.accountUUID,
        input.name,
        input.minimumLevel,
        input.maximumLevel,
        input.providerData
      )
    );
  }
  @Mutation(_returns => Vehicle)
  async updateVehicle(
    @Arg("input") input: UpdateVehicleInput,
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<Vehicle> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    // verify vehicle ownage
    await context.db.getVehicle(input.id, accountLimiter);
    const result = DBInterface.DBVehicleToVehicle(
      await context.db.updateVehicle(
        input.id,
        input.name,
        input.minimumLevel,
        input.maximumLevel,
        input.tripSchedule,
        input.pausedUntil,
        input.status,
        input.providerData
      )
    );
    await pubSub.publish(VehicleSubscriptionTopic, {
      vehicle_uuid: result.id,
      account_uuid: result.ownerID
    });
    return result;
  }
  @Mutation(_returns => Boolean)
  async updateVehicleData(
    @Arg("input") input: UpdateVehicleDataInput,
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<Boolean> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    const vehicle = await context.db.getVehicle(input.id, accountLimiter); // verify vehicle ownage

    // TODO: Add the possibility to update only partial information
    await context.logic.updateVehicleData(input);
    await pubSub.publish(VehicleSubscriptionTopic, {
      vehicle_uuid: vehicle.vehicle_uuid,
      account_uuid: vehicle.account_uuid
    });
    return true;
  }
  @Mutation(_returns => Boolean)
  async vehicleDebug(
    @Arg("input") input: VehicleDebugInput,
    @Ctx() context: IContext
  ): Promise<Boolean> {
    await context.db.storeVehicleDebug(
      DBInterface.VehicleDebugToDBVehicleDebug(input)
    );
    return true;
  }
}
