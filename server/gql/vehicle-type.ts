/**
 * @file GraphQL API Vehicle types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import {
  Field,
  ObjectType,
  InputType,
  Int,
  ID,
  registerEnumType,
  Float
} from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";
import { GeoLocation } from "./location-type";
import "reflect-metadata";

export enum SmartChargeGoal {
  low = "low",
  balanced = "balanced",
  full = "full"
}
registerEnumType(SmartChargeGoal, { name: "SmartChargeGoal" });

@ObjectType("VehicleLocationSetting")
@InputType("VehicleLocationSettingInput")
export abstract class VehicleLocationSettings {
  @Field(_type => ID, { description: `location id` })
  location!: string;
  @Field(_type => Int, {
    description: `Minimum battery level to reach directly (%)`
  })
  directLevel!: number;
  @Field(_type => String)
  goal!: SmartChargeGoal | string;
}
export function VehicleLocationSettingsToJS(
  input: VehicleLocationSettings
): VehicleLocationSettings {
  return {
    location: input.location,
    directLevel: input.directLevel,
    goal: input.goal
  };
}

@ObjectType("Schedule")
@InputType("ScheduleInput")
export abstract class Schedule {
  @Field(_type => Int, {
    description: `Battery level to reach at scheduled time (%)`
  })
  level!: number;
  @Field()
  time!: Date;
}
export function ScheduleToJS(input: Schedule): Schedule {
  return { level: input.level, time: new Date(input.time) };
}

export enum ChargeType {
  calibrate = "calibrate",
  minimum = "minimum",
  trip = "trip",
  routine = "routine",
  prefered = "prefered",
  fill = "fill"
}
registerEnumType(ChargeType, { name: "ChargeType" });

@ObjectType()
export abstract class ChargePlan {
  @Field(_type => ChargeType)
  chargeType!: ChargeType;
  @Field(_type => Date, {
    nullable: true,
    description: `time to start or null for now`
  })
  chargeStart!: Date | null;
  @Field(_type => Date, {
    nullable: true,
    description: `time to end or null for never`
  })
  chargeStop!: Date | null;
  @Field(_type => Int)
  level!: number;
  @Field()
  comment!: string;
}
export function ChargePlanToJS(input: ChargePlan): ChargePlan {
  return {
    chargeStart: (input.chargeStart && new Date(input.chargeStart)) || null,
    chargeStop: (input.chargeStop && new Date(input.chargeStop)) || null,
    chargeType: input.chargeType,
    level: input.level,
    comment: input.comment || ""
  };
}

@ObjectType()
export abstract class Vehicle {
  @Field(_type => ID)
  id!: string;
  @Field(_type => ID)
  ownerID!: string;
  @Field()
  name!: string;
  @Field(_type => Int, {
    description: `maximum level to charge to unless a trip is scheduled (%)`
  })
  maximumLevel!: number;
  @Field(_type => Int, {
    description: `smart charging anxiety level`
  })
  anxietyLevel!: number;
  @Field(_type => Schedule, { nullable: true, description: `trip schedule` })
  tripSchedule!: Schedule | null;
  @Field(_type => Date, {
    nullable: true,
    description: `smart charging paused`
  })
  pausedUntil!: Date | null;
  @Field()
  geoLocation!: GeoLocation;
  @Field(_type => ID, { nullable: true, description: `known location id` })
  location!: string | null;
  @Field(_type => [VehicleLocationSettings], {
    nullable: true,
    description: `location settings`
  })
  locationSettings!: VehicleLocationSettings[] | null;
  @Field(_type => Int, { description: `battery level (%)` })
  batteryLevel!: number;
  @Field(_type => Int, { description: `odometer (meters)` })
  odometer!: number;
  @Field(_type => Float, { description: `outside temperature (celcius)` })
  outsideTemperature!: number;
  @Field(_type => Float, { description: `inside temperature (celcius)` })
  insideTemperature!: number;
  @Field({ description: `is climate control on` })
  climateControl!: boolean;
  @Field()
  isDriving!: boolean;
  @Field({ description: `is a charger connected` })
  isConnected!: boolean;
  @Field(_type => [ChargePlan], { nullable: true, description: `charge plan` })
  chargePlan!: ChargePlan[] | null;
  @Field(_type => Int, { nullable: true, description: `charging to level (%)` })
  chargingTo!: number | null;
  @Field(_type => Int, {
    nullable: true,
    description: `estimated time to complete charge (minutes)`
  })
  estimatedTimeLeft!: number | null;
  @Field()
  status!: string;
  @Field()
  smartStatus!: string;
  @Field()
  updated!: Date;
  @Field(_type => ID)
  serviceID!: string;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData!: any;
}
export function VehicleToJS(input: Vehicle): Vehicle {
  return {
    id: input.id,
    ownerID: input.ownerID,
    name: input.name,
    maximumLevel: input.maximumLevel,
    anxietyLevel: input.anxietyLevel,
    tripSchedule:
      (input.tripSchedule && ScheduleToJS(input.tripSchedule)) || null,
    pausedUntil: (input.pausedUntil && new Date(input.pausedUntil)) || null,
    geoLocation: input.geoLocation,
    location: input.location,
    locationSettings:
      (input.locationSettings &&
        input.locationSettings.map(VehicleLocationSettingsToJS)) ||
      null,
    batteryLevel: input.batteryLevel,
    odometer: input.odometer,
    outsideTemperature: input.outsideTemperature,
    insideTemperature: input.insideTemperature,
    climateControl: input.climateControl,
    isDriving: input.isDriving,
    isConnected: input.isConnected,
    chargePlan:
      (input.chargePlan && input.chargePlan.map(ChargePlanToJS)) || null,
    chargingTo: input.chargingTo,
    estimatedTimeLeft: input.estimatedTimeLeft,
    status: input.status,
    smartStatus: input.smartStatus,
    updated: new Date(input.updated),
    serviceID: input.serviceID,
    providerData: input.providerData
  };
}

@InputType()
export abstract class UpdateVehicleInput {
  @Field(_type => ID)
  id!: string;
  @Field({ nullable: true })
  name?: string;
  @Field(_type => Int, { nullable: true })
  maximumLevel?: number;
  @Field(_type => Int, { nullable: true })
  anxietyLevel?: number;
  @Field(_type => Schedule, { nullable: true })
  tripSchedule?: Schedule | null;
  @Field(_type => Date, { nullable: true })
  pausedUntil?: Date | null;
  @Field(_type => [VehicleLocationSettings], { nullable: true })
  locationSettings?: VehicleLocationSettings[] | null;
  @Field({ nullable: true })
  status?: string;
  @Field(_type => ID, { nullable: true })
  serviceID?: string;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData?: any;
}

export enum ChargeConnection {
  ac = "ac",
  dc = "dc"
}
registerEnumType(ChargeConnection, { name: "ChargeConnection" });

@InputType()
export abstract class UpdateVehicleDataInput {
  @Field(_type => ID)
  id!: string;
  @Field()
  geoLocation!: GeoLocation;
  @Field(_type => Int, { description: `battery level (%)` })
  batteryLevel!: number;
  @Field(_type => Int, { description: `odometer (meters)` })
  odometer!: number;
  @Field(_type => Float, {
    nullable: true,
    description: `outside temperature (celcius)`
  })
  outsideTemperature!: number | null;
  @Field(_type => Float, {
    nullable: true,
    description: `inside temperature (celcius)`
  })
  insideTemperature!: number | null;
  @Field({ description: `is climate control on` })
  climateControl!: boolean;
  @Field()
  isDriving!: boolean;
  @Field(_type => ChargeConnection, {
    nullable: true,
    description: `charge connection`
  })
  connectedCharger!: ChargeConnection | null;
  @Field(_type => Int, { nullable: true, description: `charging to level (%)` })
  chargingTo!: number | null;
  @Field(_type => Int, {
    nullable: true,
    description: `estimated time to complete charge (minutes)`
  })
  estimatedTimeLeft!: number | null;
  @Field(_type => Float, {
    nullable: true,
    description: `current power use (kW)`
  })
  powerUse!: number | null;
  @Field(_type => Float, { nullable: true, description: `charge added (kWh)` })
  energyAdded!: number | null;
}

@InputType()
export abstract class VehicleDebugInput {
  @Field(_type => ID)
  id!: string;
  @Field()
  timestamp!: Date;
  @Field()
  category!: string;
  @Field(_type => GraphQLJSONObject)
  data!: any;
}

@ObjectType()
export abstract class Action {
  @Field(_type => Int)
  actionID!: number;
  @Field(_type => ID)
  serviceID!: string;
  @Field()
  providerName!: string;
  @Field()
  action!: string;
  @Field(_type => GraphQLJSONObject)
  data!: any;
}
