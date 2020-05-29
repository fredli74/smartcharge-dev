/**
 * @file GraphQL API Account resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Ctx, Mutation, Arg, Query } from "type-graphql";
import { IContext } from "@server/gql/api";
import { Account } from "./account-type";
import { SINGLE_USER_UUID, makeAccountUUID } from "@server/db-interface";
import config from "@shared/smartcharge-config";
import { AuthenticationError } from "apollo-server-core";
import { plainToClass } from "class-transformer";

const AUTH0_DOMAIN_URL = `https://${config.AUTH0_DOMAIN}/`;

import {
  verify,
  JwtHeader,
  SigningKeyCallback,
  VerifyErrors
} from "jsonwebtoken";
import JwksClient from "jwks-rsa";
const jwksClient = JwksClient({
  jwksUri: `${AUTH0_DOMAIN_URL}.well-known/jwks.json`
});
async function jwkVerify(idToken: string): Promise<any> {
  return new Promise((resolve, reject) => {
    verify(
      idToken,
      (header: JwtHeader, callback: SigningKeyCallback) => {
        if (!header.kid) {
          reject("Internal error, invalid header in jwkVerify");
        }
        jwksClient.getSigningKey(header.kid!, (err, key: any) => {
          var signingKey = key.publicKey || key.rsaPublicKey;
          callback(null, signingKey);
        });
      },
      { audience: config.AUTH0_CLIENT_ID, issuer: AUTH0_DOMAIN_URL },
      (err: VerifyErrors | null, decoded: object | undefined) => {
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
  @Query(_returns => Account)
  async account(@Ctx() context: IContext): Promise<Account> {
    return plainToClass(
      Account,
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
    return plainToClass(Account, await context.db.getAccount(SINGLE_USER_UUID));
  }

  @Mutation(_returns => Account)
  async loginWithIDToken(
    @Arg("idToken") idToken: string,
    @Ctx() context: IContext
  ): Promise<Account> {
    if (config.SINGLE_USER === "true") {
      throw new AuthenticationError(
        `loginWithIDToken not allowed in SINGLE_USER mode`
      );
    }
    const payload = await jwkVerify(idToken);
    if (!payload || !payload.iss || !payload.sub || !payload.name) {
      throw new AuthenticationError(
        `Invalid token, required payload is iss, sub and name`
      );
    }
    const [domain, subject] = payload.sub.split("|");
    const uuid = makeAccountUUID(subject, domain);
    try {
      return plainToClass(Account, await context.db.getAccount(uuid));
    } catch {
      return plainToClass(
        Account,
        await context.db.makeAccount(uuid, payload.name)
      );
    }
  }
}
