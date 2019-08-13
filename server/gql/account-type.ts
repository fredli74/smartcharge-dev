/**
 * @file GraphQL API Account types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Field, ObjectType, ID } from "type-graphql";
import "reflect-metadata";

@ObjectType()
export abstract class Account {
  @Field(_type => ID)
  id!: string;
  @Field()
  name!: string;
  @Field()
  token!: string;
}
