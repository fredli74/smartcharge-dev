/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

// import { strict as assert } from 'assert';

import { ApolloServer, ApolloError } from "apollo-server-express";
import { buildSchema, Arg, Resolver, Query, Ctx, Mutation } from "type-graphql";
import { DBInterface, INTERNAL_SERVICE_UUID } from "./db-interface";
import { DBAccount } from "./db-schema";
import { Logic } from "./logic";

import express from "express";
import "reflect-metadata";

import config from "@shared/smartcharge-config.json";
import PASSWORD from "./smartcharge-password.json";

import { ProviderResolver } from "./resolvers/provider-resolver";
import { VehicleResolver } from "./resolvers/vehicle-resolver";
import { LocationResolver } from "./resolvers/location-resolver";
import { Account, ChartData, ChargePlanToJS } from "@shared/gql-types";

@Resolver()
class AccountResolver {
  @Query(_returns => Account)
  async account(@Ctx() context: IContext): Promise<Account> {
    return DBInterface.DBAccountToAccount(
      await context.db.getAccount(context.accountUUID)
    );
  }

  @Mutation(_returns => Account)
  async loginWithPassword(
    @Arg("password") password: string,
    @Ctx() context: IContext
  ): Promise<Account> {
    if (!config.SINGLE_USER) {
      throw new ApolloError(
        `loginWithPassword only allowed in SINGLE_USER mode`,
        `AUTHENTICATION_FAILED`
      );
    }
    if (password !== PASSWORD.SINGLE_USER_PASSWORD) {
      throw new ApolloError(
        `loginWithPassword called with invalid password`,
        `AUTHENTICATION_FAILED`
      );
    }
    return DBInterface.DBAccountToAccount(
      await context.db.getAccount(INTERNAL_SERVICE_UUID)
    );
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
}

export interface IContext {
  db: DBInterface;
  logic: Logic;
  accountUUID: string;
  account?: DBAccount;
}
const schema = buildSchema({
  resolvers: [
    LocationResolver,
    ProviderResolver,
    VehicleResolver,
    AccountResolver
  ],
  emitSchemaFile: true,
  validate: false
});
export default schema;
