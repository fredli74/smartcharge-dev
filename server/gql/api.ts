/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

// import { strict as assert } from 'assert';

import {
  buildSchema,
  Resolver,
  Subscription,
  Root,
  Int,
  ObjectType,
  Field,
  ResolverInterface,
  Query,
  FieldResolver
} from "type-graphql";
import { DBInterface, INTERNAL_SERVICE_UUID } from "@server/db-interface";
import { DBAccount } from "@server/db-schema";
import { Logic } from "@server/logic";
import "reflect-metadata";
import { AccountResolver } from "./account-resolver";
import { ProviderResolver } from "./provider-resolver";
import { VehicleResolver } from "./vehicle-resolver";
import { LocationResolver } from "./location-resolver";
import { ServiceResolver } from "./service-resolver";
import { PriceResolver } from "./price-resolver";
import { apolloPubSub, SubscriptionTopic } from "./subscription";
import { GraphQLSchema } from "graphql";
import { AccountTypeResolver } from './account-type';
import { LocationTypeResolver } from './location-type';

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

@Resolver()
export class PingResolver {
  @Subscription(_returns => Int, {
    subscribe: () => {
      return apolloPubSub.asyncIterator(SubscriptionTopic.Ping);
    }
  })
  async pingSubscription(@Root() payload: number): Promise<number> {
    return payload;
  }
}

setInterval(() => {
  apolloPubSub.publish(SubscriptionTopic.Ping, Math.trunc(Date.now() / 1e3));
}, 30e3);

@ObjectType()
export class Player {
  @Field()
  isMe: boolean = false;
}

@Resolver(() => Player)
export class PlayerResolver implements ResolverInterface<Player> {
  @Query(() => Player)
  player() {
    return new Player();
  }

  @FieldResolver(() => Boolean)
  isMe() {
    return true;
  }
}

export default function schema(emitFile?: string): Promise<GraphQLSchema> {
  return buildSchema({
    resolvers: [
      PingResolver,
      AccountTypeResolver,
      AccountResolver,
      ProviderResolver,
      VehicleResolver,
      LocationTypeResolver,
      LocationResolver,
      PriceResolver,
      ServiceResolver,
      PlayerResolver
    ],
    emitSchemaFile: !!emitFile && emitFile,
    validate: false
  });
}
