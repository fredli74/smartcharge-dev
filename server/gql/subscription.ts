/**
 * @file GraphQL API Subscription helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { createPubSub } from "@graphql-yoga/subscription";
import { Resolver, Subscription, Root, Int } from "type-graphql";

export enum SubscriptionTopic {
  ActionUpdate = "ACTION_UPDATE",
  VehicleUpdate = "VEHICLE_UPDATE",
  Ping = "PING",
}

// The one pub/sub of the schema: type-graphql subscribes `topics` on it and resolvers publish to it
export const pubSub = createPubSub();

@Resolver()
export class PingResolver {
  @Subscription((_returns) => Int, { topics: SubscriptionTopic.Ping })
  async pingSubscription(@Root() payload: number): Promise<number> {
    return payload;
  }
}

setInterval(() => {
  pubSub.publish(SubscriptionTopic.Ping, Math.trunc(Date.now() / 1e3));
}, 30e3);
