/**
 * @file Provider API resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { ApolloError } from "apollo-server-express";
import providers from "@providers/provider-servers";
import { Arg, Resolver, Query, Ctx, Mutation } from "type-graphql";
import { ProviderSubject } from "@shared/gql-types";
import { GraphQLJSONObject } from "graphql-type-json";
import { IContext } from "@server/gql-api";
import { INTERNAL_SERVICE_UUID } from "@server/db-interface";
import { IProviderServer } from "@providers/provider-server";

const providerMap = providers.reduce(
  (a, p) => {
    a[p.name.toLowerCase()] = p;
    return a;
  },
  {} as { [name: string]: IProviderServer }
);

@Resolver()
export class ProviderResolver {
  @Query(_returns => [ProviderSubject])
  async providerSubjects(
    @Arg("accept", _type => [String]) accept: string[],
    @Ctx() context: IContext
  ): Promise<ProviderSubject[]> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    return context.db.getProviderSubjects(accountLimiter, accept);
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
