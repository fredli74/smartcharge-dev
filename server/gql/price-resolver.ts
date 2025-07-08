/**
 * @file GraphQL API Price resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Query, Ctx, Arg, Mutation, ID } from "type-graphql";
import { accountFilter } from "@server/gql/api.js";
import type { IContext } from "@server/gql/api.js";
import { PriceList, UpdatePriceListInput } from "./price-type.js";
import { plainToInstance } from "class-transformer";
import { GraphQLError } from "graphql";

@Resolver()
export class PriceResolver {
  @Query((_returns) => [PriceList])
  async priceLists(@Ctx() context: IContext): Promise<PriceList[]> {
    return plainToInstance(
      PriceList,
      await context.db.getPriceLists(accountFilter(context.accountUUID))
    );
  }

  @Query((_returns) => PriceList)
  async priceList(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    return plainToInstance(
      PriceList,
      await context.db.getPriceList(accountFilter(context.accountUUID), id)
    );
  }

  @Mutation((_returns) => PriceList)
  async newPriceList(
    @Arg("name", (_type) => String) name: string,
    @Arg("isPublic", (_type) => Boolean, {
      nullable: true,
      defaultValue: false,
    })
      isPublic: boolean,
    @Arg("id", (_type) => ID, { nullable: true }) id: string,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    if (!context.accountUUID) {
      throw new GraphQLError("Not logged in",
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
      );
    }
    return plainToInstance(
      PriceList,
      await context.db.newPriceList(context.accountUUID, name, isPublic, id)
    );
  }

  @Mutation((_returns) => PriceList)
  async updatePriceList(
    @Arg("input") input: UpdatePriceListInput,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    // verify PriceList ownage
    const accountID = accountFilter(context.accountUUID);
    const list = await context.db.getPriceList(accountID, input.id);
    if (accountID === undefined || list.account_uuid === accountID) {
      // Because we can list public lists, but no edit them
      throw new GraphQLError("Update access denied",
        undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHORIZED" }
      );
    }
    return plainToInstance(
      PriceList,
      await context.db.updatePriceList(input.id, {
        name: input.name,
        public_list: input.isPublic,
      })
    );
  }
}
