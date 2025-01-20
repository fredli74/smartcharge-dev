/**
 * @file GraphQL API Location resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Query, Ctx, Arg, Mutation, ID } from "type-graphql";
import { IContext, accountFilter } from "@server/gql/api";
import { UpdateLocationInput, Location } from "./location-type";
import { makePublicID, LogLevel, log } from "@shared/utils";
import { plainToInstance } from "class-transformer";
import { ApolloError } from "apollo-server-core";

@Resolver()
export class LocationResolver {
  @Query((_returns) => [Location])
  async locations(@Ctx() context: IContext): Promise<Location[]> {
    return plainToInstance(
      Location,
      await context.db.getLocations(accountFilter(context.accountUUID))
    );
  }
  @Query((_returns) => Location)
  async location(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Location> {
    return plainToInstance(
      Location,
      await context.db.getLocation(accountFilter(context.accountUUID), id)
    );
  }

  @Mutation((_returns) => Location)
  async updateLocation(
    @Arg("input") input: UpdateLocationInput,
    @Ctx() context: IContext
  ): Promise<Location> {
    // verify Location ownage
    await context.db.getLocation(accountFilter(context.accountUUID), input.id);
    return plainToInstance(
      Location,
      await context.db.updateLocation(input.id, {
        name: input.name,
        location_micro_latitude:
          input.geoLocation === undefined
            ? undefined
            : input.geoLocation.latitude * 1e6,
        location_micro_longitude:
          input.geoLocation === undefined
            ? undefined
            : input.geoLocation.longitude * 1e6,
        radius: input.geoFenceRadius,
        price_list_uuid: input.priceListID,
        service_uuid: input.serviceID,
        provider_data: input.providerData,
      })
    );
  }

  @Mutation((_returns) => Boolean)
  async removeLocation(
    @Arg("id", (_type) => ID) id: string,
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
