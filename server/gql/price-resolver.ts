/**
 * @file GraphQL API Location resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Query, Ctx, Arg, Mutation } from "type-graphql";
import { IContext, accountFilter } from "@server/gql/api";
import { PriceList, UpdatePriceListInput } from "./price-type";
import { plainToClass } from "class-transformer";
import { ApolloError } from "apollo-server-core";

@Resolver()
export class PriceResolver {
  @Query(_returns => [PriceList])
  async priceLists(@Ctx() context: IContext): Promise<PriceList[]> {
    return plainToClass(
      PriceList,
      await context.db.getPriceLists(accountFilter(context.accountUUID))
    );
  }

  @Query(_returns => PriceList)
  async priceList(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    return plainToClass(
      PriceList,
      await context.db.getPriceList(accountFilter(context.accountUUID), id)
    );
  }

  @Mutation(_returns => PriceList)
  async updatePriceList(
    @Arg("input") input: UpdatePriceListInput,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    // verify PriceList ownage
    const accountID = accountFilter(context.accountUUID);
    const list = await context.db.getPriceList(accountID, input.id);
    if (accountID === undefined || list.account_uuid === accountID) {
      // Because we can list public lists, but no edit them
      throw new ApolloError("Update access denied");
    }
    return plainToClass(
      PriceList,
      await context.db.updatePriceList(input.id, {
        name: input.name,
        private_list: input.isPrivate
      })
    );
  }
}
