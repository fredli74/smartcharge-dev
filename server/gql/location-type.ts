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
  Ctx,
  Float,
} from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";

import "reflect-metadata";
import { DBLocation } from "@server/db-schema";
import { PriceList } from "./price-type";
import { IContext } from "./api";
import { plainToClass } from "class-transformer";
import { PriceResolver } from "./price-resolver";

@ObjectType()
@InputType("GeoLocationInput")
export class GeoLocation {
  @Field((_type) => Float)
  latitude!: number;
  @Field((_type) => Float)
  longitude!: number;
}

@ObjectType()
export class Location extends DBLocation {}

@Resolver((_of) => Location)
export class LocationTypeResolver {
  @FieldResolver((_returns) => ID)
  id(@Root() location: Location): string {
    return location.location_uuid;
  }
  @FieldResolver((_returns) => ID)
  ownerID(@Root() location: Location): string {
    return location.account_uuid;
  }
  @FieldResolver((_returns) => String)
  name(@Root() location: Location): string {
    return location.name;
  }

  @FieldResolver((_returns) => GeoLocation)
  geoLocation(@Root() location: Location): GeoLocation {
    return plainToClass(GeoLocation, {
      latitude: location.location_micro_latitude / 1e6,
      longitude: location.location_micro_longitude / 1e6,
    });
  }

  @FieldResolver((_returns) => Int, {
    nullable: true,
    description: `Radius in meters`,
  })
  geoFenceRadius(@Root() location: Location): number {
    return location.radius;
  }

  @FieldResolver((_returns) => ID, { nullable: true })
  serviceID(@Root() location: Location): string | null {
    return location.service_uuid;
  }
  @FieldResolver((_returns) => GraphQLJSONObject, { nullable: true })
  providerData(@Root() location: Location): any {
    return location.provider_data;
  }
  @FieldResolver((_returns) => String, { nullable: true })
  async priceListID(@Root() location: Location): Promise<string | null> {
    return location.price_list_uuid;
  }
  @FieldResolver((_returns) => PriceList, { nullable: true })
  async priceList(
    @Root() location: Location,
    @Ctx() context: IContext
  ): Promise<PriceList | null> {
    if (location.price_list_uuid === null) {
      return null;
    }
    return new PriceResolver().priceList(location.price_list_uuid, context);
  }
}

@InputType()
export abstract class UpdateLocationInput {
  @Field((_type) => ID)
  id!: string;
  @Field((_type) => String, { nullable: true })
  name?: string;
  @Field((_type) => GeoLocation, { nullable: true })
  geoLocation?: GeoLocation;
  @Field((_type) => Int, { nullable: true, description: `Radius in meters` })
  geoFenceRadius?: number;
  @Field((_type) => ID, { nullable: true })
  priceListID?: string;
  @Field((_type) => ID, { nullable: true })
  serviceID?: string;
  @Field((_type) => GraphQLJSONObject, { nullable: true })
  providerData?: any;
}
