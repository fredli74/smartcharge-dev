/**
 * @file GraphQL API Location types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import "reflect-metadata";
import {
  Field,
  ObjectType,
  InputType,
  ID,
  FieldResolver,
  Root,
  Resolver,
  Float,
  GraphQLISODateTime,
} from "type-graphql";
import { DBPriceList } from "@server/db-schema";

@ObjectType("PriceList")
export class PriceList extends DBPriceList {}

@Resolver((_of) => PriceList)
export class PriceListTypeResolver {
  @FieldResolver((_returns) => ID)
  id(@Root() pricelist: PriceList): string {
    return pricelist.price_list_uuid;
  }
  @FieldResolver((_returns) => ID)
  ownerID(@Root() pricelist: PriceList): string {
    return pricelist.account_uuid;
  }
  @FieldResolver((_returns) => String)
  name(@Root() pricelist: PriceList): string {
    return pricelist.name;
  }
  @FieldResolver((_returns) => Boolean)
  isPublic(@Root() pricelist: PriceList): boolean {
    return pricelist.public_list;
  }
}

@InputType()
export class UpdatePriceListInput {
  @Field((_type) => ID)
  id!: string;
  @Field((_type) => String)
  name!: string;
  @Field((_type) => Boolean)
  isPublic!: boolean;
}

@ObjectType("PriceData")
@InputType("PriceDataInput")
export class PriceData {
  @Field((_type) => GraphQLISODateTime, {
    description: `Price tariff start time`,
  })
  startAt!: Date;
  @Field((_type) => Float, {
    description: `Price in currency per kWh (5 decimal precision)`,
  })
  price!: number;
}

@InputType()
export abstract class UpdatePriceInput {
  @Field((_type) => ID)
  priceListID!: string;
  @Field((_type) => [PriceData])
  prices!: PriceData[];
}
