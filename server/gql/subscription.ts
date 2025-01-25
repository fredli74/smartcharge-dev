/**
 * @file GraphQL API Subscription helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { PubSub } from "graphql-subscriptions";
import { Resolver, Subscription, Root, Int } from "type-graphql";

export enum SubscriptionTopic {
  ActionUpdate = "ACTION_UPDATE",
  VehicleUpdate = "VEHICLE_UPDATE",
  Ping = "PING",
}

export const apolloPubSub = new PubSub();

@Resolver()
export class PingResolver {
  @Subscription((_returns) => Int, {
    subscribe: () => {
      return apolloPubSub.asyncIterator(SubscriptionTopic.Ping);
    },
  })
  async pingSubscription(@Root() payload: number): Promise<number> {
    return payload;
  }
}

setInterval(() => {
  apolloPubSub.publish(SubscriptionTopic.Ping, Math.trunc(Date.now() / 1e3));
}, 30e3);
