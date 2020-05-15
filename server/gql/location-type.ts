/**
 * @file GraphQL API Location types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import {
  Field,
  ObjectType,
  InputType,
  Int,
  ID,
  FieldResolver,
  Root,
  Resolver,
  Ctx
} from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";

import "reflect-metadata";
import { DBLocation } from "@server/db-schema";
import { PriceList } from "./price-type";
import { IContext } from "./api";
import { DBInterface } from "@server/db-interface";

@ObjectType()
@InputType("GeoLocationInput")
export abstract class GeoLocation {
  @Field()
  latitude!: number;
  @Field()
  longitude!: number;
}

@ObjectType()
export class Location extends DBLocation {}

@Resolver(_of => Location)
export class LocationTypeResolver {
  @FieldResolver(_returns => ID)
  id(@Root() location: Location): string {
    return location.location_uuid;
  }
  @FieldResolver(_returns => ID)
  ownerID(@Root() location: Location): string {
    return location.account_uuid;
  }
  @FieldResolver(_returns => String)
  name(@Root() location: Location): string {
    return location.name;
  }

  @FieldResolver(_returns => GeoLocation)
  geoLocation(@Root() location: Location): GeoLocation {
    return {
      latitude: location.location_micro_latitude / 1e6,
      longitude: location.location_micro_longitude / 1e6
    };
  }

  @FieldResolver(_returns => Int, {
    nullable: true,
    description: `Radius in meters`
  })
  geoFenceRadius(@Root() location: Location): number {
    return location.radius;
  }

  @FieldResolver(_returns => ID, { nullable: true })
  serviceID(@Root() location: Location): string | null {
    return location.service_uuid;
  }
  @FieldResolver(_returns => GraphQLJSONObject, { nullable: true })
  providerData(@Root() location: Location): any {
    return location.provider_data;
  }
  @FieldResolver(_returns => PriceList, { nullable: true })
  async priceList(
    @Root() location: Location,
    @Ctx() context: IContext
  ): Promise<PriceList | undefined> {
    if (location.price_code) {
      return DBInterface.DBPriceListToPriceList(
        await context.db.getPriceList(undefined, location.price_code)
      );
    }
  }
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
  @Field(_type => ID, { nullable: true })
  priceListID?: string;
  @Field(_type => ID, { nullable: true })
  serviceID?: string;
  @Field(_type => GraphQLJSONObject, { nullable: true })
  providerData?: any;
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
  debugger;
  return { price: input.price, startAt: new Date(input.startAt) };
}

@InputType()
export abstract class UpdatePriceInput {
  @Field(_type => String)
  code!: string;
  @Field(_type => LocationPrice)
  prices!: LocationPrice[];
}
