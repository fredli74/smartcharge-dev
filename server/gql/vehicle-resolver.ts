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
  Root,
  Int,
  ID
} from "type-graphql";
import { IContext } from "./api";
import { DBInterface, INTERNAL_SERVICE_UUID } from "@server/db-interface";
import {
  Vehicle,
  NewVehicleInput,
  UpdateVehicleInput,
  UpdateVehicleDataInput,
  VehicleDebugInput,
  ChargePlanToJS
} from "./vehicle-type";
import { ChartData } from "./location-type";
import { log, LogLevel } from "@shared/utils";

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
      return DBInterface.DBVehicleToVehicle(
        await context.db.getVehicle(payload.vehicle_uuid, payload.account_uuid)
      );
    } else {
      // This happens when called without websockets
      return DBInterface.DBVehicleToVehicle(
        await context.db.getVehicle(id, context.accountUUID)
      );
    }
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
    log(LogLevel.Debug, `updateVehicle: ${JSON.stringify(input)}`);
    await context.db.getVehicle(input.id, accountLimiter);
    const result = DBInterface.DBVehicleToVehicle(
      await context.db.updateVehicle(
        input.id,
        input.name,
        input.minimumLevel,
        input.maximumLevel,
        input.anxietyLevel,
        input.tripSchedule,
        input.pausedUntil,
        input.status,
        input.providerData
      )
    );
    if (
      input.minimumLevel !== undefined ||
      input.maximumLevel !== undefined ||
      input.anxietyLevel !== undefined ||
      input.tripSchedule !== undefined
    ) {
      await context.logic.refreshChargePlan(input.id);
    }
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
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
    await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
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

  @Query(_returns => ChartData)
  async chartData(
    @Arg("vehicleID") vehicle_uuid: string,
    @Arg("locationID") location_uuid: string,
    @Ctx() context: IContext
  ): Promise<ChartData> {
    const vehicle = await context.db.getVehicle(
      vehicle_uuid,
      context.accountUUID
    );

    const location = await context.db.getLocation(
      location_uuid,
      context.accountUUID
    );

    const stats = await context.logic.currentStats(vehicle_uuid, location_uuid);
    const averagePrice =
      stats.weekly_avg7_price +
      (stats.weekly_avg7_price - stats.weekly_avg21_price) / 2;

    const chartData = await context.db.getChartData(location_uuid, 48);
    return {
      locationID: location.location_uuid,
      locationName: location.name,
      vehicleID: vehicle.vehicle_uuid,
      batteryLevel: vehicle.level,
      thresholdPrice: Math.trunc((averagePrice * stats.threshold) / 100),
      levelChargeTime: stats.level_charge_time,
      prices: chartData.map(f => ({ startAt: f.ts, price: f.price })),
      chargePlan:
        (vehicle.charge_plan && vehicle.charge_plan.map(ChargePlanToJS)) ||
        null,
      minimumLevel: vehicle.minimum_charge,
      maximumLevel: vehicle.maximum_charge
    };
  }

  @Mutation(_returns => Int, { nullable: true })
  async chargeCalibration(
    @Arg("vehicleID", _type => ID) vehicle_uuid: string,
    @Arg("level", _type => Int, { nullable: true }) level: number,
    @Arg("duration", _type => Int, { nullable: true }) duration: number,
    @Ctx() context: IContext
  ): Promise<number> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    // verify vehicle ownage
    const vehicle = await context.db.getVehicle(vehicle_uuid, accountLimiter);

    if (!level || !duration) {
      return await context.db.chargeCalibration(
        vehicle.vehicle_uuid,
        vehicle.charge_id
      );
    } else {
      const result = await context.db.setChargeCurve(
        vehicle.vehicle_uuid,
        vehicle.charge_id,
        level,
        duration,
        undefined,
        undefined,
        undefined
      );
      await context.logic.refreshChargePlan(vehicle.vehicle_uuid);
      return result.level;
    }
  }
}
