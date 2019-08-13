/**
 * @file GraphQL API Subscription helper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { PubSub } from "graphql-subscriptions";

export enum SubscriptionTopic {
  ActionUpdate = "ACTION_UPDATE",
  VehicleUpdate = "VEHICLE_UPDATE"
}

export const apolloPubSub = new PubSub();
