/**
 * @file Provider API resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { ApolloError } from "apollo-server-express";
import providers, { IProviderServer } from "@providers/provider-servers";
import { Arg, Resolver, Query, Ctx, Mutation } from "type-graphql";
import { IContext } from "../gql-api";
import { Provider, UpdateProviderInput } from "@shared/gql-types";
import { GraphQLJSONObject } from "graphql-type-json";
import { DBInterface, INTERNAL_SERVICE_UUID } from "../db-interface";

const providerMap = providers.reduce(
  (a, p) => {
    a[p.name.toLowerCase()] = p;
    return a;
  },
  {} as { [name: string]: IProviderServer }
);

@Resolver()
export class ProviderResolver {
  @Query(_returns => [Provider])
  async providers(
    @Arg("accept", _type => [String], { nullable: true }) accept: string[],
    @Ctx() context: IContext
  ): Promise<Provider[]> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    const dblist = await context.db.getProviders(accountLimiter, accept);
    return dblist.map(DBInterface.DBProviderToProvider);
  }

  @Mutation(_returns => Provider)
  async newProvider(
    @Arg("name") name: string,
    @Arg("data", _type => GraphQLJSONObject) data: any,
    @Ctx() context: IContext
  ): Promise<Provider> {
    return DBInterface.DBProviderToProvider(
      await context.db.newProvider(context.accountUUID, name, data)
    );
  }

  @Mutation(_returns => Provider)
  async updateProviderData(
    @Arg("input") input: UpdateProviderInput,
    @Ctx() context: IContext
  ): Promise<Provider[]> {
    debugger;
    if (input.id === undefined && input.name === undefined) {
      throw new ApolloError(
        `Either id or name must be specified in UpdateProviderInput`
      );
    }
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;

    const dblist = await context.db.updateProviderData(
      accountLimiter,
      input.id,
      input.name,
      input.filter,
      input.data
    );
    return dblist.map(DBInterface.DBProviderToProvider);
  }

  @Query(_returns => GraphQLJSONObject)
  async providerQuery(
    @Arg("name", { description: `Provider name` }) name: string,
    @Arg("input", _type => GraphQLJSONObject) input: any,
    @Ctx() context: IContext
  ): Promise<any> {
    const provider = providerMap[name];
    if (provider === undefined) {
      throw new ApolloError("Invalid provider name specified");
    }
    if (provider.query === undefined) {
      throw new ApolloError(
        "Query not implemented in provider " + provider.name
      );
    }
    return {
      result: await provider.query(input, context)
    };
  }

  @Mutation(_returns => GraphQLJSONObject)
  async providerMutate(
    @Arg("name", { description: `Provider name` }) name: string,
    @Arg("input", _type => GraphQLJSONObject) input: any,
    @Ctx() context: IContext
  ): Promise<any> {
    const provider = providerMap[name];
    if (provider === undefined) {
      throw new ApolloError("Invalid provider name specified");
    }
    if (provider.mutation === undefined) {
      throw new ApolloError(
        "Mutation not implemented in provider " + provider.name
      );
    }
    return {
      result: await provider.mutation(input, context)
    };
  }
}
