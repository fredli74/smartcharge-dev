/**
 * @file GraphQL API Location types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Field, ObjectType, InputType, Int, ID } from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";

import "reflect-metadata";
import { ChargePlan } from "./vehicle-type";

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
  @Field(_type => String, { nullable: true })
  priceCode?: string;
  @Field(_type => ID)
  serviceID!: string;
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
  @Field(_type => String)
  code!: string;
  @Field(_type => LocationPrice)
  prices!: LocationPrice[];
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
  @Field(_type => String, { nullable: true })
  priceCode?: string;
  @Field(_type => ID, { nullable: true })
  serviceID?: string;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData?: any;
}

@ObjectType()
export abstract class ChartData {
  @Field(_type => ID)
  locationID!: string;
  @Field()
  locationName!: string;
  @Field(_type => ID)
  vehicleID!: string;
  @Field(_type => Int)
  batteryLevel!: number;
  @Field(_type => Int)
  levelChargeTime!: number;
  @Field(_type => Int)
  thresholdPrice!: number;
  @Field(_type => GraphQLJSONObject)
  chargeCurve!: any;
  @Field(_type => LocationPrice)
  prices!: LocationPrice[];
  @Field(_type => [ChargePlan], { nullable: true })
  chargePlan!: ChargePlan[] | null;
  @Field(_type => Int)
  directLevel!: number;
  @Field(_type => Int)
  maximumLevel!: number;
}
