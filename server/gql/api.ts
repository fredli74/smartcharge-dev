/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

// import { strict as assert } from 'assert';

import { buildSchema, Resolver, Subscription, Root, Int } from "type-graphql";
import { DBInterface } from "@server/db-interface";
import { DBAccount } from "@server/db-schema";
import { Logic } from "@server/logic";
import "reflect-metadata";
import { AccountResolver } from "./account-resolver";
import { ProviderResolver } from "./provider-resolver";
import { VehicleResolver } from "./vehicle-resolver";
import { LocationResolver } from "./location-resolver";
import { ServiceResolver } from "./service-resolver";
import { apolloPubSub, SubscriptionTopic } from "./subscription";

export interface IContext {
  db: DBInterface;
  logic: Logic;
  accountUUID: string;
  account?: DBAccount;
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

const schema = buildSchema({
  resolvers: [
    PingResolver,
    AccountResolver,
    ProviderResolver,
    VehicleResolver,
    LocationResolver,
    ServiceResolver
  ],
  emitSchemaFile: true,
  validate: false
});
export default schema;
