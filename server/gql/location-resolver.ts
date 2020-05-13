/**
 * @file GraphQL API Location resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Query, Ctx, Arg, Mutation } from "type-graphql";
import { IContext, accountFilter } from "@server/gql/api";
import { UpdateLocationInput, Location } from "./location-type";
import { makePublicID, LogLevel, log } from "@shared/utils";
import { ApolloError } from "apollo-server-express";
import { DBInterface } from "@server/db-interface";
import { plainToClass } from "class-transformer";

@Resolver()
export class LocationResolver {
  @Query(_returns => [Location])
  async locations(@Ctx() context: IContext): Promise<Location[]> {
    const dblist = await context.db.getLocations(
      accountFilter(context.accountUUID)
    );
    return dblist.map(DBInterface.DBLocationToLocation);
  }
  @Query(_returns => Location)
  async location(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Location> {
    const l = DBInterface.DBLocationToLocation(
      await context.db.getLocation(accountFilter(context.accountUUID), id)
    );
    return plainToClass(Location, l);
  }

  @Mutation(_returns => Location)
  async updateLocation(
    @Arg("input") input: UpdateLocationInput,
    @Ctx() context: IContext
  ): Promise<Location> {
    // verify Location ownage
    await context.db.getLocation(accountFilter(context.accountUUID), input.id);
    return DBInterface.DBLocationToLocation(
      await context.db.updateLocation(
        input.id,
        input.name,
        input.geoLocation,
        input.geoFenceRadius,
        input.priceListID,
        input.serviceID,
        input.providerData
      )
    );
  }

  @Mutation(_returns => Boolean)
  async removeLocation(
    @Arg("id") id: string,
    @Arg("confirm") confirm: string,
    @Ctx() context: IContext
  ): Promise<Boolean> {
    // verify location ownage
    log(LogLevel.Debug, `removeLocation: ${JSON.stringify(id)}`);
    const location = await context.db.getLocation(
      accountFilter(context.accountUUID),
      id
    );

    const publicID = makePublicID(location.location_uuid);
    if (confirm.toLowerCase() !== publicID) {
      throw new ApolloError("Incorrect confirmation code");
    }

    await context.db.removeLocation(id);
    return true;
  }
}
