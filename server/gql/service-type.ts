/**
 * @file GraphQL API Service types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Field, ObjectType, ID } from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";
import "reflect-metadata";

@ObjectType()
export abstract class ServiceProvider {
  @Field(_type => ID)
  ownerID!: string;
  @Field()
  providerName!: string;
  @Field(_type => ID)
  serviceID!: string;
  @Field(_type => GraphQLJSONObject)
  serviceData!: any;
}
