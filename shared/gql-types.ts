/**
 * @file GraphQL API Types for smartcharge.dev project
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

import "reflect-metadata";

@ObjectType()
@InputType("GeoLocationInput")
export abstract class GeoLocation {
  @Field()
  latitude!: number;
  @Field()
  longitude!: number;
}

@ObjectType()
export abstract class Location {
  @Field(_type => ID)
  id!: string;
  @Field(_type => ID)
  ownerID!: string;
  @Field()
  name!: string;
  @Field()
  geoLocation!: GeoLocation;
  @Field(_type => Int, { description: `Radius in meters` })
  geoFenceRadius!: number;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData!: any;
}

@ObjectType("LocationPrice")
@InputType("LocationPriceInput")
export abstract class LocationPrice {
  @Field({ description: `Price tariff start time` })
  startAt!: Date;
  @Field({ description: `Price in currency per kWh (5 decimal precision)` })
  price!: number;
}
export function LocationPriceToJS(input: LocationPrice): LocationPrice {
  return { price: input.price, startAt: new Date(input.startAt) };
}

@InputType()
export abstract class UpdatePriceInput {
  @Field(_type => ID)
  id!: string;
  @Field(_type => LocationPrice)
  prices!: LocationPrice[];
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
  minimum = "minimum",
  routine = "routine",
  fill = "fill",
  trip = "trip"
}
registerEnumType(ChargeType, { name: "ChargeType" });

@ObjectType()
export abstract class ChargePlan {
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
  @Field(_type => ChargeType)
  chargeType!: ChargeType;
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
    description: `minimum level to instantly charge to (%)`
  })
  minimumLevel!: number;
  @Field(_type => Int, {
    description: `maximum level to charge to unless a trip is scheduled (%)`
  })
  maximumLevel!: number;
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
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData!: any;
}
export function VehicleToJS(input: Vehicle): Vehicle {
  return {
    id: input.id,
    ownerID: input.ownerID,
    name: input.name,
    minimumLevel: input.minimumLevel,
    maximumLevel: input.maximumLevel,
    tripSchedule:
      (input.tripSchedule && ScheduleToJS(input.tripSchedule)) || null,
    pausedUntil: (input.pausedUntil && new Date(input.pausedUntil)) || null,
    geoLocation: input.geoLocation,
    location: input.location,
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
  minimumLevel?: number;
  @Field(_type => Int, { nullable: true })
  maximumLevel?: number;
  @Field(_type => Schedule, { nullable: true })
  tripSchedule?: Schedule | null;
  @Field(_type => Date, { nullable: true })
  pausedUntil?: Date | null;
  @Field({ nullable: true })
  status?: string;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData?: any;
}

@InputType()
export abstract class NewVehicleInput {
  @Field()
  name!: string;
  @Field(_type => Int)
  minimumLevel!: number;
  @Field(_type => Int)
  maximumLevel!: number;
  @Field(_type => GraphQLJSONObject, {
    nullable: true,
    description: "Vehicle provider data"
  })
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
  @Field(_type => Float, { description: `outside temperature (celcius)` })
  outsideTemperature!: number;
  @Field(_type => Float, { description: `inside temperature (celcius)` })
  insideTemperature!: number;
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
    description: `current power used (kW)`
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
export abstract class Account {
  @Field(_type => ID)
  id!: string;
  @Field()
  name!: string;
  @Field()
  token!: string;
}

@ObjectType()
export abstract class ProviderSubject {
  @Field(_type => ID)
  subjectID!: string;
  @Field(_type => ID)
  ownerID!: string;
  @Field()
  providerType!: string;
  @Field()
  providerName!: string;
  @Field(_type => GraphQLJSONObject)
  providerData!: any;
}

@InputType()
export abstract class NewLocationInput {
  @Field()
  name!: string;
  @Field(_type => GeoLocation)
  geoLocation!: GeoLocation;
  @Field(_type => Int, { nullable: true, description: `Radius in meters` })
  geoFenceRadius!: number;
  @Field(_type => GraphQLJSONObject, {
    nullable: true,
    description: "Location provider data"
  })
  providerData?: any;
}

@InputType()
export abstract class UpdateLocationInput {
  @Field(_type => ID)
  id!: string;
  @Field({ nullable: true })
  name?: string;
  @Field(_type => GeoLocation, { nullable: true })
  geoLocation?: GeoLocation;
  @Field(_type => Int, { nullable: true, description: `Radius in meters` })
  geoFenceRadius?: number;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData?: any;
}

@ObjectType()
export abstract class ChartData {
  @Field(_type => ID)
  locationID!: string;
  @Field(_type => ID)
  vehicleID!: string;
  @Field(_type => Int)
  levelChargeTime!: number;
  @Field(_type => Int)
  thresholdPrice!: number;
  @Field(_type => LocationPrice)
  prices!: LocationPrice[];
  @Field(_type => [ChargePlan], { nullable: true })
  chargePlan!: ChargePlan[] | null;
}
