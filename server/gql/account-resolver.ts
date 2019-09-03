/**
 * @file GraphQL API Account resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Ctx, Mutation, Arg, Query } from "type-graphql";
import { IContext } from "@server/gql/api";
import { Account } from "./account-type";
import {
  DBInterface,
  SINGLE_USER_UUID,
  makeAccountUUID
} from "@server/db-interface";
import config from "@shared/smartcharge-config";
import { AuthenticationError } from "apollo-server-core";

import { OAuth2Client } from "google-auth-library";
const googleAuthClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

@Resolver()
export class AccountResolver {
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
    if (config.SINGLE_USER !== "true") {
      throw new AuthenticationError(
        `loginWithPassword only allowed in SINGLE_USER mode`
      );
    }
    if (password !== config.SINGLE_USER_PASSWORD) {
      throw new AuthenticationError(
        `loginWithPassword called with invalid password`
      );
    }
    return DBInterface.DBAccountToAccount(
      await context.db.getAccount(SINGLE_USER_UUID)
    );
  }

  @Mutation(_returns => Account)
  async loginWithGoogle(
    @Arg("idToken") idToken: string,
    @Ctx() context: IContext
  ): Promise<Account> {
    if (config.SINGLE_USER === "true") {
      throw new AuthenticationError(
        `loginWithGoogle not allowed in SINGLE_USER mode`
      );
    }
    const token = await googleAuthClient.verifyIdToken({
      audience: config.GOOGLE_CLIENT_ID,
      idToken: idToken
    });
    const payload = token.getPayload();
    if (!payload || !payload.iss || !payload.sub || !payload.name) {
      throw new AuthenticationError(
        `Invalid token, required payload is iss, sub and name`
      );
    }
    const uuid = makeAccountUUID(payload.sub, payload.iss);
    try {
      return DBInterface.DBAccountToAccount(await context.db.getAccount(uuid));
    } catch {
      return DBInterface.DBAccountToAccount(
        await context.db.makeAccount(uuid, payload.name)
      );
    }
  }
}
