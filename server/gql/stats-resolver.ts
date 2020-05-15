/**
 * @file GraphQL API Stats resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import "reflect-metadata";
import { Field, ObjectType, Int, ID } from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";
import { ChargePlan } from "./vehicle-type";
import { Arg, Resolver, Query, Ctx } from "type-graphql";
import { IContext, accountFilter } from "./api";
import { plainToClass } from "class-transformer";
import { PriceData } from "./price-type";

@ObjectType()
export class ChartData {
  @Field(_type => ID)
  locationID!: string;
  @Field(_type => String)
  locationName!: string;
  @Field(_type => ID)
  vehicleID!: string;
  @Field(_type => Int)
  batteryLevel!: number;
  @Field(_type => Int, { nullable: true })
  levelChargeTime!: number | null;
  @Field(_type => Int, { nullable: true })
  thresholdPrice!: number | null;
  @Field(_type => GraphQLJSONObject)
  chargeCurve!: any;
  @Field(_type => PriceData)
  prices!: PriceData[];
  @Field(_type => [ChargePlan], { nullable: true })
  chargePlan!: ChargePlan[] | null;
  @Field(_type => Int)
  directLevel!: number;
  @Field(_type => Int)
  maximumLevel!: number;
}

@Resolver()
export class StatsResolver {
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

    const priceData = await context.db.getChartPriceData(location_uuid, 48);
    debugger; // check chartdata, it had a
    //chargePlan:
    //        (vehicle.charge_plan && vehicle.charge_plan.map(ChargePlanToJS)) ||
    //        null,

    const chartData: ChartData = plainToClass(ChartData, {
      locationID: location.location_uuid,
      locationName: location.name,
      vehicleID: vehicle.vehicle_uuid,
      batteryLevel: vehicle.level,
      thresholdPrice: null,
      levelChargeTime: null,
      chargeCurve: chargecurve,
      prices: priceData.map(f =>
        plainToClass(PriceData, {
          startAt: f.ts,
          price: f.price
        } as PriceData)
      ),
      chargePlan:
        vehicle.charge_plan ||
        (vehicle.charge_plan as ChargePlan[]).map(f =>
          plainToClass(ChargePlan, f)
        ),
      maximumLevel: vehicle.maximum_charge
    } as ChartData);

    const stats = await context.logic.currentStats(vehicle_uuid, location_uuid);
    if (
      stats &&
      stats.weekly_avg7_price &&
      stats.weekly_avg21_price &&
      stats.threshold
    ) {
      const averagePrice =
        stats.weekly_avg7_price +
        (stats.weekly_avg7_price - stats.weekly_avg21_price) / 2;

      chartData.thresholdPrice = Math.trunc(
        (averagePrice * stats.threshold) / 100
      );
      chartData.levelChargeTime = stats.level_charge_time;
    }

    return chartData;
  }
}
