/**
 * @file GraphQL API Provider resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { SubscriptionTopic, apolloPubSub } from "./subscription.js";
import {
  Resolver,
  Ctx,
  Mutation,
  Arg,
  ID,
  Subscription,
  Root,
  Int,
  Query,
  ObjectType,
  Field,
} from "type-graphql";
import type { IContext } from "@server/gql/api.js";
import { GraphQLJSONObject } from "graphql-type-json";
import { INTERNAL_SERVICE_UUID } from "@server/db-interface.js";
import { withFilter } from "graphql-subscriptions";
import providers from "@providers/provider-servers.js";
import { IProviderServer } from "@providers/provider-server.js";
import { DBServiceProvider } from "@server/db-schema.js";
import { GraphQLError } from "graphql";

const actionMemDatabase: { [id: string]: Action } = {};
let actionMemDatabaseSN = 0;

const providerMap = providers.reduce((a, p) => {
  a[p.name.toLowerCase()] = p;
  return a;
}, {} as { [name: string]: IProviderServer });

@ObjectType()
export abstract class Action {
  @Field((_type) => Int)
    actionID!: number;
  @Field((_type) => ID)
    serviceID!: string;
  @Field()
    providerName!: string;
  @Field()
    action!: string;
  @Field((_type) => GraphQLJSONObject)
    data!: any;
}

@Resolver()
export class ProviderResolver {
  // TODO: replace provider query and mutate with provider actions?
  @Query((_returns) => GraphQLJSONObject)
  async providerQuery(
    @Arg("name", { description: `Provider name` }) name: string,
    @Arg("input", (_type) => GraphQLJSONObject) input: any,
    @Ctx() context: IContext
  ): Promise<any> {
    const provider = providerMap[name];
    if (provider === undefined) {
      throw new GraphQLError("Invalid provider name specified",
        undefined, undefined, undefined, undefined, undefined, { code: "PROVIDER_ERROR" }
      );
    }
    if (provider.query === undefined) {
      throw new GraphQLError(`Query not implemented in provider ${provider.name}`,
        undefined, undefined, undefined, undefined, undefined, { code: "PROVIDER_ERROR" }
      );
    }
    return {
      result: await provider.query(input, context),
    };
  }
  @Mutation((_returns) => GraphQLJSONObject)
  async providerMutate(
    @Arg("name", { description: `Provider name` }) name: string,
    @Arg("input", (_type) => GraphQLJSONObject) input: any,
    @Ctx() context: IContext
  ): Promise<any> {
    const provider = providerMap[name];
    if (provider === undefined) {
      throw new GraphQLError(`Invalid provider name (${name}) specified`,
        undefined, undefined, undefined, undefined, undefined, { code: "PROVIDER_ERROR" }
      );
    }
    if (provider.mutation === undefined) {
      throw new GraphQLError(`Mutation not implemented in provider ${provider.name}`,
        undefined, undefined, undefined, undefined, undefined, { code: "PROVIDER_ERROR" }
      );
    }
    return {
      result: await provider.mutation(input, context),
    };
  }

  @Mutation((_returns) => GraphQLJSONObject)
  async performAction(
    @Arg("actionID", (_type) => Int, { nullable: true }) actionID: number,
    @Arg("serviceID", (_type) => ID) serviceID: string,
    @Arg("action") action: string,
    @Arg("data", (_type) => GraphQLJSONObject, { nullable: true })
      data: any | null,
    @Ctx() context: IContext
  ): Promise<Action> {
    const service = (await context.db.pg.oneOrNone(
      `SELECT * FROM service_provider WHERE service_uuid = $1;`,
      [serviceID]
    )) as DBServiceProvider;

    if (
      !service ||
      (context.accountUUID !== INTERNAL_SERVICE_UUID &&
        service.account_uuid !== context.accountUUID)
    ) {
      throw new GraphQLError("Invalid service id specified",
        undefined, undefined, undefined, undefined, undefined, { code: "BAD_USER_INPUT" }
      );
    }

    const id =
      actionMemDatabase[actionID] !== undefined
        ? actionID
        : actionMemDatabaseSN++;
    const actionObj: Action = {
      actionID: id,
      serviceID: service.service_uuid,
      providerName: service.provider_name,
      action: action,
      data: data || {},
    };

    if (actionObj.data.result !== undefined) {
      delete actionMemDatabase[actionObj.actionID]; //cleanup
    } else {
      actionMemDatabase[actionObj.actionID] = actionObj;
    }

    await apolloPubSub.publish(SubscriptionTopic.ActionUpdate, actionObj);
    return actionObj;
  }

  @Subscription((_returns) => Action, {
    subscribe: withFilter(
      (_payload?: Action, args?: any, context?: IContext) => {
        if (!args || !context) {
          throw new GraphQLError("Internal error",
            undefined, undefined, undefined, undefined, undefined, { code: "PROVIDER_ERROR" }
          );
        }
        if (args.providerName === undefined && args.serviceID === undefined) {
          throw new GraphQLError("Argument error",
            undefined, undefined, undefined, undefined, undefined, { code: "PROVIDER_ERROR" }
          );
        }
        if (
          args.serviceID === undefined &&
          context.accountUUID !== INTERNAL_SERVICE_UUID
        ) {
          throw new GraphQLError("Permission denied",
            undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
          );
        }
        return apolloPubSub.asyncIterator(SubscriptionTopic.ActionUpdate);
      },
      (payload?: Action, args?: any, _context?: IContext) => {
        return Boolean(
          args &&
            payload &&
            (args.providerName === undefined ||
              args.providerName === payload.providerName) &&
            (args.serviceID === undefined ||
              args.serviceID === payload.serviceID)
        );
      }
    ),
  })
  async actionSubscription(
    @Root() payload: Action,
    @Arg("providerName", (_type) => String, { nullable: true })
      _providerName: string | null,
    @Arg("serviceID", (_type) => ID, { nullable: true })
      _serviceID: string | null,
    @Ctx() _context: IContext
  ): Promise<Action> {
    return payload;
  }
}
