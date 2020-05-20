/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

// import { strict as assert } from 'assert';

import "reflect-metadata";
import {
  buildSchema,
  Field,
  FieldResolver,
  ObjectType,
  Query,
  Resolver,
  ResolverInterface
} from "type-graphql";
import { AccountResolver } from "./account-resolver";
import { AccountTypeResolver } from "./account-type";
import { DBAccount } from "@server/db-schema";
import { DBInterface, INTERNAL_SERVICE_UUID } from "@server/db-interface";
import { GraphQLSchema } from "graphql";
import { LocationResolver } from "./location-resolver";
import { LocationTypeResolver } from "./location-type";
import { Logic } from "@server/logic";
import { PriceResolver } from "./price-resolver";
import { ProviderResolver } from "./provider-resolver";
import { ServiceResolver } from "./service-resolver";
import { StatsResolver } from "./stats-resolver";
import { VehicleResolver } from "./vehicle-resolver";
import { VehicleTypeResolver } from "./vehicle-type";
import { PingResolver } from "./subscription";
import { PriceListTypeResolver } from "./price-type";
import { ServiceProviderTypeResolver } from "./service-type";

export interface IContext {
  db: DBInterface;
  logic: Logic;
  accountUUID: string;
  account?: DBAccount;
}

export function accountFilter(
  account_uuid?: string
): string | null | undefined {
  return account_uuid === undefined
    ? null // no access
    : account_uuid === INTERNAL_SERVICE_UUID
    ? undefined // all access
    : account_uuid; // normal access
}

@ObjectType()
export class ResolverTest {
  @Field()
  isFieldResolverWorking: boolean = false;
}

@Resolver(() => ResolverTest)
export class TestResolver implements ResolverInterface<ResolverTest> {
  @Query(() => ResolverTest)
  test() {
    return new ResolverTest();
  }

  @FieldResolver(() => Boolean)
  isFieldResolverWorking() {
    return true;
  }
}

export default function schema(emitFile?: string): Promise<GraphQLSchema> {
  return buildSchema({
    resolvers: [
      PingResolver,
      TestResolver,

      AccountTypeResolver,
      AccountResolver,

      ProviderResolver,

      PriceListTypeResolver,
      PriceResolver,

      LocationTypeResolver,
      LocationResolver,

      VehicleTypeResolver,
      VehicleResolver,

      ServiceProviderTypeResolver,
      ServiceResolver,

      StatsResolver
    ],
    emitSchemaFile: !!emitFile && emitFile,
    validate: false
  });
}
