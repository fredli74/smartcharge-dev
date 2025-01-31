/**
 * @file GraphQL API Account resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Ctx, Mutation, Arg, Query } from "type-graphql";
import type { IContext } from "@server/gql/api.js";
import { Account } from "./account-type.js";
import { SINGLE_USER_UUID, makeAccountUUID } from "@server/db-interface.js";
import config from "@shared/smartcharge-config.js";
import { plainToInstance } from "class-transformer";
import { GraphQLError } from 'graphql';

const AUTH0_DOMAIN_URL = `https://${config.AUTH0_DOMAIN}/`;

import JsonWebToken from "jsonwebtoken";
import JwksClient from "jwks-rsa";
const jwksClient = JwksClient({
  jwksUri: `${AUTH0_DOMAIN_URL}.well-known/jwks.json`,
});
async function jwkVerify(idToken: string): Promise<JsonWebToken.JwtPayload | string | undefined> {
  return new Promise((resolve, reject) => {
    JsonWebToken.verify(
      idToken,
      (header: JsonWebToken.JwtHeader, callback: JsonWebToken.SigningKeyCallback) => {
        if (!header.kid) {
          reject("Internal error, invalid header in jwkVerify");
        }
        jwksClient.getSigningKey(header.kid!, (_err, key: any) => {
          const signingKey = key.publicKey || key.rsaPublicKey;
          callback(null, signingKey);
        });
      },
      { audience: config.AUTH0_CLIENT_ID, issuer: AUTH0_DOMAIN_URL },
      (err: JsonWebToken.VerifyErrors | null, decoded: JsonWebToken.JwtPayload | string | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      }
    );
  });
}

@Resolver()
export class AccountResolver {
  @Query((_returns) => Account)
  async account(@Ctx() context: IContext): Promise<Account> {
    if (!context.accountUUID) {
      throw new GraphQLError("Not logged in",
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
      );
    }
    return plainToInstance(
      Account,
      await context.db.getAccount(context.accountUUID)
    );
  }

  @Mutation((_returns) => Account)
  async loginWithPassword(
    @Arg("password") password: string,
    @Ctx() context: IContext
  ): Promise<Account> {
    if (!config.SINGLE_USER) {
      throw new GraphQLError(
        "loginWithPassword only allowed in SINGLE_USER mode",
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
      );
    }
    if (password !== config.SINGLE_USER_PASSWORD) {
      throw new GraphQLError(
        `loginWithPassword called with invalid password`,
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
      );
    }
    return plainToInstance(Account, await context.db.getAccount(SINGLE_USER_UUID));
  }

  @Mutation((_returns) => Account)
  async loginWithIDToken(
    @Arg("idToken") idToken: string,
    @Ctx() context: IContext
  ): Promise<Account> {
    if (config.SINGLE_USER) {
      throw new GraphQLError(
        `loginWithIDToken not allowed in SINGLE_USER mode`,
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
      );
    }
    const payload = await jwkVerify(idToken); 
    if (typeof payload !== "object" || !payload.iss || !payload.sub || !payload.name) {
      throw new GraphQLError(
        `Invalid token, required payload is iss, sub and name`,
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
      );
    }
    const [domain, subject] = payload.sub.split("|");
    const uuid = makeAccountUUID(subject, domain);
    try {
      return plainToInstance(Account, await context.db.getAccount(uuid));
    } catch {
      return plainToInstance(
        Account,
        await context.db.makeAccount(uuid, payload.name)
      );
    }
  }
}
