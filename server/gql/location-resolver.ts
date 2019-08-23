/**
 * @file GraphQL API Location resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Query, Ctx, Arg, Mutation } from "type-graphql";
import { IContext } from "@server/gql/api";
import { DBInterface, INTERNAL_SERVICE_UUID } from "@server/db-interface";
import { UpdateLocationInput, Location } from "./location-type";

@Resolver()
export class LocationResolver {
  @Query(_returns => [Location])
  async locations(@Ctx() context: IContext): Promise<Location[]> {
    const dblist = await context.db.getLocations(context.accountUUID);
    return dblist.map(DBInterface.DBLocationToLocation);
  }
  @Query(_returns => Location)
  async location(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Location> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    return DBInterface.DBLocationToLocation(
      await context.db.getLocation(id, accountLimiter)
    );
  }

  @Mutation(_returns => Location)
  async updateLocation(
    @Arg("input") input: UpdateLocationInput,
    @Ctx() context: IContext
  ): Promise<Location> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    // verify Location ownage
    await context.db.getLocation(input.id, accountLimiter);
    return DBInterface.DBLocationToLocation(
      await context.db.updateLocation(
        input.id,
        input.name,
        input.geoLocation,
        input.geoFenceRadius,
        input.priceCode,
        input.serviceID,
        input.providerData
      )
    );
  }
}
