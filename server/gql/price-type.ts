/**
 * @file GraphQL API Location types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Field, ObjectType, InputType, ID } from "type-graphql";

import "reflect-metadata";

@ObjectType("PriceList")
@InputType("PriceListInput")
export class PriceList {
  @Field(_type => ID)
  id!: string;
  @Field(_type => ID)
  ownerID!: string;
  @Field()
  name!: string;
  @Field(_type => Boolean)
  private!: boolean;
}

@InputType()
export class UpdatePriceListInput {
  @Field(_type => ID)
  id!: string;
  @Field()
  name!: string;
  @Field(_type => Boolean)
  private!: boolean;
}
