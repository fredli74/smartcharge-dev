/**
 * @file GraphQL API Location resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Query, Ctx, Arg, Mutation } from "type-graphql";
import { IContext, accountFilter } from "@server/gql/api";
import { DBInterface } from "@server/db-interface";
import { PriceList, UpdatePriceListInput } from "./price-type";

@Resolver()
export class PriceResolver {
  @Query(_returns => [PriceList])
  async priceLists(@Ctx() context: IContext): Promise<PriceList[]> {
    const dblist = await context.db.getPriceLists(
      accountFilter(context.accountUUID)
    );
    return dblist.map(DBInterface.DBPriceListToPriceList);
  }

  @Query(_returns => PriceList)
  async priceList(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    return DBInterface.DBPriceListToPriceList(
      await context.db.getPriceList(accountFilter(context.accountUUID), id)
    );
  }

  @Mutation(_returns => PriceList)
  async updatePriceList(
    @Arg("input") input: UpdatePriceListInput,
    @Ctx() context: IContext
  ): Promise<PriceList> {
    // verify PriceList ownage
    await context.db.getPriceList(accountFilter(context.accountUUID), input.id);
    return DBInterface.DBPriceListToPriceList(
      await context.db.updatePriceList(input.id, input.name, input.private)
    );
  }
}
