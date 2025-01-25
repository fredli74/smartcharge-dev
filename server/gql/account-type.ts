/**
 * @file GraphQL API Account types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import "reflect-metadata";
import { ObjectType, ID, Resolver, Root, FieldResolver } from "type-graphql";
import { DBAccount } from "@server/db-schema.js";

@ObjectType()
export class Account extends DBAccount {}

@Resolver((_of) => Account)
export class AccountTypeResolver {
  @FieldResolver((_returns) => ID)
  id(@Root() account: Account): string {
    return account.account_uuid;
  }
  @FieldResolver((_returns) => String)
  name(@Root() account: Account): string {
    return account.name;
  }
  @FieldResolver((_returns) => String)
  token(@Root() account: Account): string {
    return account.api_token;
  }
}
