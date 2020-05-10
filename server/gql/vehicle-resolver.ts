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
import { DBInterface, INTERNAL_SERVICE_UUID } from "@server/db-interface";
import {
  Vehicle,
  UpdateVehicleInput,
  ChargePlanToJS,
  VehicleLocationSettings
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
    const dblist = await context.db.getVehicles(
      accountFilter(context.accountUUID)
    );
    return dblist.map(DBInterface.DBVehicleToVehicle);
  }
  @Query(_returns => Vehicle)
  async vehicle(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    return DBInterface.DBVehicleToVehicle(
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
      return DBInterface.DBVehicleToVehicle(
        await context.db.getVehicle(
          accountFilter(payload.account_uuid),
          payload.vehicle_uuid
        )
      );
    } else {
      // This happens when called without websockets
      return DBInterface.DBVehicleToVehicle(
        await context.db.getVehicle(accountFilter(context.accountUUID), id)
      );
    }
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

    const result = DBInterface.DBVehicleToVehicle(
      await context.db.updateVehicle(
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
      )
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
      vehicle_uuid: result.id,
      account_uuid: result.ownerID
    });
    return result;
  }

  @Query(_returns => ChartData)
  async chartData(
    @Arg("vehicleID") vehicle_uuid: string,
    @Arg("locationID") location_uuid: string,
    @Ctx() context: IContext
  ): Promise<ChartData> {
    const vehicle = await context.db.getVehicle(
      accountFilter(context.accountUUID),
      vehicle_uuid
    );

    const location = await context.db.getLocation(
      accountFilter(context.accountUUID),
      location_uuid
    );

    const chargecurve = await context.db.getChargeCurve(
      vehicle && vehicle.vehicle_uuid,
      location && location.location_uuid
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
      chargeCurve: chargecurve,
      prices: chartData.map(f => ({ startAt: f.ts, price: f.price })),
      chargePlan:
        (vehicle.charge_plan && vehicle.charge_plan.map(ChargePlanToJS)) ||
        null,
      directLevel: DBInterface.DBVehicleToVehicleLocationSettings(
        vehicle,
        location.location_uuid
      ).directLevel,
      maximumLevel: vehicle.maximum_charge
    };
  }
}
