/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

// import { strict as assert } from 'assert';

import { ApolloServer, ApolloError } from "apollo-server-express";
import { buildSchema, Arg, Resolver, Query, Ctx, Mutation } from "type-graphql";
import { DBInterface, INTERNAL_SERVICE_UUID } from "./db-interface";
import { DBAccount } from "./db-schema";
import { Logic } from "./logic";

import express from "express";
import "reflect-metadata";

import config from "@shared/smartcharge-config.json";
import PASSWORD from "./smartcharge-password.json";

import { ProviderResolver } from "./resolvers/provider-resolver";
import { VehicleResolver } from "./resolvers/vehicle-resolver";
import { LocationResolver } from "./resolvers/location-resolver";
import { Account } from "@shared/gql-types";

@Resolver()
class AccountResolver {
  @Query(_returns => Account)
  async account(@Ctx() context: IContext): Promise<Account> {
    return DBInterface.DBAccountToAccount(
      await context.db.getAccount(context.accountUUID)
    );
  }

  @Mutation(_returns => Account)
  async loginWithPassword(
    @Arg("password") password: string,
    @Ctx() context: IContext
  ): Promise<Account> {
    if (!config.SINGLE_USER) {
      throw new ApolloError(
        `loginWithPassword only allowed in SINGLE_USER mode`,
        `AUTHENTICATION_FAILED`
      );
    }
    if (password !== PASSWORD.SINGLE_USER_PASSWORD) {
      throw new ApolloError(
        `loginWithPassword called with invalid password`,
        `AUTHENTICATION_FAILED`
      );
    }
    return DBInterface.DBAccountToAccount(
      await context.db.getAccount(INTERNAL_SERVICE_UUID)
    );
  }
}

export interface IContext {
  db: DBInterface;
  logic: Logic;
  accountUUID: string;
  account?: DBAccount;
}

export async function gqlServer(
  app: express.Express,
  db: DBInterface,
  logic: Logic
) {
  const schema = await buildSchema({
    resolvers: [
      LocationResolver,
      ProviderResolver,
      VehicleResolver,
      AccountResolver
    ],
    emitSchemaFile: true,
    validate: false
  });
  const server = new ApolloServer({
    playground: true,
    schema,
    context: ({ res }) => {
      return <IContext>{
        db,
        logic,
        accountUUID:
          (res.locals.account && res.locals.account.account_uuid) || undefined,
        account: res.locals.account
      };
    }
  });
  server.applyMiddleware({ app, path: "/api/gql" });
}
