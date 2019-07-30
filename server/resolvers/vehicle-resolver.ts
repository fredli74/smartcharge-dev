/**
 * @file Vehicle API resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Arg, Resolver, Query, Ctx, Mutation } from "type-graphql";
import { IContext } from "../gql-api";
import {
  Vehicle,
  UpdateVehicleInput,
  UpdateVehicleDataInput,
  VehicleDebugInput,
  NewVehicleInput
} from "@shared/gql-types";
import { GraphQLJSONObject } from "graphql-type-json";
import { DBInterface, INTERNAL_SERVICE_UUID } from "../db-interface";
import { DBVehicle } from "server/db-schema";

@Resolver()
export class VehicleResolver {
  @Query(_returns => [Vehicle])
  async vehicles(@Ctx() context: IContext): Promise<Vehicle[]> {
    const dblist = await context.db.getVehicles(context.accountUUID);
    return dblist.map(DBInterface.DBVehicleToVehicle);
  }
  @Query(_returns => Vehicle)
  async vehicle(
    @Arg("id") id: string,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    return DBInterface.DBVehicleToVehicle(
      await context.db.getVehicle(id, accountLimiter)
    );
  }

  @Mutation(_returns => Vehicle)
  async newVehicle(
    @Arg("input") input: NewVehicleInput,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    return DBInterface.DBVehicleToVehicle(
      await context.db.newVehicle(
        context.accountUUID,
        input.name,
        input.minimumLevel,
        input.maximumLevel,
        input.providerData
      )
    );
  }
  @Mutation(_returns => Vehicle)
  async updateVehicle(
    @Arg("input") input: UpdateVehicleInput,
    @Ctx() context: IContext
  ): Promise<Vehicle> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    // verify vehicle ownage
    await context.db.getVehicle(input.id, accountLimiter);
    debugger;
    return DBInterface.DBVehicleToVehicle(
      await context.db.updateVehicle(
        input.id,
        input.name,
        input.minimumLevel,
        input.maximumLevel,
        input.tripSchedule,
        input.pausedUntil,
        input.status,
        input.providerData
      )
    );
  }
  @Mutation(_returns => Boolean)
  async updateVehicleData(
    @Arg("input") input: UpdateVehicleDataInput,
    @Ctx() context: IContext
  ): Promise<Boolean> {
    const accountLimiter =
      context.accountUUID === INTERNAL_SERVICE_UUID
        ? undefined
        : context.accountUUID;
    await context.db.getVehicle(input.id, accountLimiter); // verify vehicle ownage

    // TODO: Add the possibility to update only partial information
    await context.logic.updateVehicleData(input);
    return true;
  }
  @Mutation(_returns => Boolean)
  async vehicleDebug(
    @Arg("input") input: VehicleDebugInput,
    @Ctx() context: IContext
  ): Promise<Boolean> {
    await context.db.storeVehicleDebug(
      DBInterface.VehicleDebugToDBVehicleDebug(input)
    );
    return true;
  }
}
