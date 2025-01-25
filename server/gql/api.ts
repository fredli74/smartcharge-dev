/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
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
  ResolverInterface,
} from "type-graphql";
import { AccountResolver } from "./account-resolver.js";
import { AccountTypeResolver } from "./account-type.js";
import { DBAccount } from "@server/db-schema.js";
import { DBInterface, INTERNAL_SERVICE_UUID } from "@server/db-interface.js";
import { GraphQLSchema } from "graphql";
import { LocationResolver } from "./location-resolver.js";
import { LocationTypeResolver } from "./location-type.js";
import { Logic } from "@server/logic.js";
import { PriceResolver } from "./price-resolver.js";
import { ProviderResolver } from "./provider-resolver.js";
import { ServiceResolver } from "./service-resolver.js";
import { StatsResolver } from "./stats-resolver.js";
import { VehicleResolver } from "./vehicle-resolver.js";
import { VehicleTypeResolver, ScheduleTypeResolver } from "./vehicle-type.js";
import { PingResolver } from "./subscription.js";
import { PriceListTypeResolver } from "./price-type.js";
import { ServiceProviderTypeResolver } from "./service-type.js";

export interface IContext {
  db: DBInterface;
  logic: Logic;
  accountUUID?: string;
  account?: DBAccount;
}

export function accountFilter(
  account_uuid?: string
): string | null | undefined {
  return (
    account_uuid === undefined ? null
    : account_uuid === INTERNAL_SERVICE_UUID ? undefined // all access
    : account_uuid // normal access
  );
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

      ScheduleTypeResolver,
      VehicleTypeResolver,
      VehicleResolver,

      ServiceProviderTypeResolver,
      ServiceResolver,

      StatsResolver,
    ],
    emitSchemaFile: !!emitFile && emitFile,
    validate: { forbidUnknownValues: false },
  });
}
