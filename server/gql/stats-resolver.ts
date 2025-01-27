/**
 * @file GraphQL API Stats resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import "reflect-metadata";
import { Field, ObjectType, Int, ID, Float, registerEnumType, GraphQLISODateTime } from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";
import { ChargePlan, VehicleLocationSettings } from "./vehicle-type.js";
import { Arg, Resolver, Query, Ctx } from "type-graphql";
import { accountFilter } from "./api.js";
import type { IContext } from "./api.js";
import { plainToInstance } from "class-transformer";
import { PriceData } from "./price-type.js";
import { DBInterface } from "@server/db-interface.js";
import {
  DBPriceData,
  DBStatsMap,
  DBSleep,
  DBCharge,
  DBTrip,
} from "@server/db-schema.js";
import type { UnstructuredData } from "@server/db-schema.js";
import { EventType } from "@shared/sc-types.js";

registerEnumType(EventType, { name: "EventType" });

@ObjectType()
export class EventList {
  @Field((_type) => EventType)
    eventType!: EventType;
  @Field((_type) => GraphQLISODateTime)
    start!: Date;
  @Field((_type) => GraphQLISODateTime)
    end!: Date;
  @Field((_type) => GraphQLJSONObject, { nullable: true })
    data!: UnstructuredData | null;
}

@ObjectType()
export class StateMap {
  @Field((_type) => GraphQLISODateTime)
    start!: Date;
  @Field((_type) => Int)
    period!: number;

  @Field((_type) => Int)
    minimumLevel!: number;
  @Field((_type) => Int)
    maximumLevel!: number;
  @Field((_type) => Int)
    drivenSeconds!: number;
  @Field((_type) => Int)
    drivenMeters!: number;
  @Field((_type) => Int)
    chargedSeconds!: number;
  @Field((_type) => Float)
    chargedEnergy!: number;
  @Field((_type) => Float)
    chargeCost!: number;
  @Field((_type) => Float)
    chargeCostSaved!: number;
}

@ObjectType()
export class ChartData {
  @Field((_type) => ID)
    vehicleID!: string;
  @Field((_type) => Int)
    batteryLevel!: number;
  @Field((_type) => GraphQLJSONObject)
    chargeCurve!: any;
  @Field((_type) => Int)
    directLevel!: number;
  @Field((_type) => Int)
    maximumLevel!: number;
  @Field((_type) => ID, { nullable: true })
    locationID!: string | null;
  @Field((_type) => Float, { nullable: true })
    thresholdPrice!: number | null;
  @Field((_type) => [PriceData], { nullable: true })
    prices!: PriceData[] | null;
  @Field((_type) => [ChargePlan], { nullable: true })
    chargePlan!: ChargePlan[] | null;
  @Field((_type) => ID, { nullable: true })
    chargePlanLocationID!: string | null;
  @Field((_type) => [StateMap])
    stateMap!: StateMap[];
  @Field((_type) => [EventList])
    eventList!: EventList[];
}

@Resolver()
export class StatsResolver {
  @Query((_returns) => ChartData)
  async chartData(
    @Arg("vehicleID") vehicle_uuid: string,
    @Arg("from", (_type) => GraphQLISODateTime) from: Date,
    @Arg("period", (_type) => Int, { nullable: true, defaultValue: 60 })
      period: number,
    @Arg("locationID", { nullable: true }) location_uuid: string | null,
    @Ctx() context: IContext
  ): Promise<ChartData> {
    const vehicle = await context.db.getVehicle(accountFilter(context.accountUUID), vehicle_uuid);

    const chargecurve = await context.db.getChargeCurve(vehicle_uuid, location_uuid);

    const stateMap = (await context.db.pg.manyOrNone(
      `SELECT * FROM state_map
      WHERE vehicle_uuid = $1 AND stats_ts >= $2 AND period = $3
      ORDER BY stats_ts`,
      [vehicle_uuid, from, period]
    )) as DBStatsMap[];

    const eventList: EventList[] = [];
    ((await context.db.pg.manyOrNone(`SELECT * FROM sleep WHERE vehicle_uuid = $1 AND end_ts >= $2`, [vehicle_uuid, from])) as DBSleep[])
      .forEach((f) => {
        eventList.push({
          eventType: EventType.Sleep,
          start: f.start_ts,
          end: f.end_ts,
          data: { active: f.active },
        });
      });
    ((await context.db.pg.manyOrNone(`SELECT * FROM charge WHERE vehicle_uuid = $1 AND end_ts >= $2`, [vehicle_uuid, from])) as DBCharge[])
      .forEach((f) => {
        eventList.push({
          eventType: EventType.Charge,
          start: f.start_ts,
          end: f.end_ts,
          data: {
            startLevel: f.start_level,
            endLevel: f.end_level,
            charger: f.type,
            addedLevel: f.end_level - f.start_level,
            addedEnergy: (f.end_added - f.start_added) / 60e3,
            energyUsed: f.energy_used / 60e3,
          },
        });
      });
    ((await context.db.pg.manyOrNone(`SELECT * FROM trip WHERE vehicle_uuid = $1 AND end_ts >= $2`, [vehicle_uuid, from])) as DBTrip[])
      .forEach((f) => {
        eventList.push({
          eventType: EventType.Trip,
          start: f.start_ts,
          end: f.end_ts,
          data: {
            startLevel: f.start_level,
            endLevel: f.end_level,
            distance: f.distance,
          },
        });
      });

    const chartData: ChartData = plainToInstance(ChartData, {
      locationID: location_uuid,
      vehicleID: vehicle.vehicle_uuid,
      batteryLevel: vehicle.level,
      thresholdPrice: null,
      chargeCurve: chargecurve,
      prices: null,
      chargePlan:
        (vehicle.charge_plan &&
          (vehicle.charge_plan as ChargePlan[]).map((f) =>
            plainToInstance(ChargePlan, f)
          )) ||
        null,
      chargePlanLocationID: vehicle.charge_plan_location_uuid,
      directLevel: (
        location_uuid && vehicle.location_settings[location_uuid] ? vehicle.location_settings[location_uuid] as VehicleLocationSettings :
        DBInterface.DefaultVehicleLocationSettings()
      ).directLevel,
      maximumLevel: vehicle.maximum_charge,
      stateMap: stateMap.map((f) =>
        plainToInstance(StateMap, {
          start: f.stats_ts,
          period: f.period,
          minimumLevel: f.minimum_level,
          maximumLevel: f.maximum_level,
          drivenSeconds: f.driven_seconds,
          drivenMeters: f.driven_meters,
          chargedSeconds: f.charged_seconds,
          chargedEnergy: f.charge_energy / 60e3,
          chargeCost: f.charge_cost / 1e5,
          chargeCostSaved: f.charge_cost_saved / 1e5,
        } as StateMap)
      ),
      eventList: eventList.sort((a, b) => a.end.getTime() - b.end.getTime()),
    } as ChartData);

    if (location_uuid) {
      const priceData = (await context.db.pg.manyOrNone(
        `SELECT p.* FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid)
          WHERE location_uuid = $1 AND ts >= $2
          ORDER BY ts;`,
        [location_uuid, from]
      )) as DBPriceData[];
      chartData.prices = priceData.map(
        (f) =>
          plainToInstance(PriceData, {
            startAt: f.ts,
            price: f.price / 1e5,
          } as PriceData) || null
      );

      const stats = await context.logic.currentStats(vehicle, location_uuid);
      if (stats && stats.weekly_avg7_price && stats.weekly_avg21_price && stats.threshold) {
        const averagePrice =
          stats.weekly_avg7_price + (stats.weekly_avg7_price - stats.weekly_avg21_price) / 2;
        chartData.thresholdPrice =
          Math.trunc((averagePrice * stats.threshold) / 100) / 1e5;
      }
    }

    return chartData;
  }
}
