/**
 * @file GraphQL API Service resolver for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { Resolver, Ctx, Mutation, Arg, ID, Int, Query, Float, PubSub, PubSubEngine } from "type-graphql";
import { GraphQLError } from "graphql";
import { SubscriptionTopic } from "./subscription.js";
import type { IContext } from "@server/gql/api.js";
import { INTERNAL_SERVICE_UUID } from "@server/db-interface.js";
import { UpdateVehicleDataInput } from "./vehicle-type.js";
import { ServiceProvider } from "./service-type.js";
import { plainToInstance } from "class-transformer";
import { UpdatePriceInput } from "./price-type.js";
import { log, LogLevel } from "@shared/utils.js";

function authorizeService(context: IContext) {
  if (context.accountUUID !== INTERNAL_SERVICE_UUID) {
    throw new GraphQLError("Access denied",
      undefined, undefined, undefined, undefined, undefined, { code: "UNAUTHENTICATED" }
    );
  }
}

@Resolver()
export class ServiceResolver {
  @Query((_returns) => [ServiceProvider])
  async _serviceProviders(
    @Arg("accept", (_type) => [String]) accept: string[],
    @Ctx() context: IContext
  ): Promise<ServiceProvider[]> {
    authorizeService(context);
    return plainToInstance(
      ServiceProvider,
      await context.db.getServiceProviders(undefined, undefined, accept)
    );
  }

  @Mutation((_returns) => Boolean)
  async _updateVehicleData(
    @Arg("input") input: UpdateVehicleDataInput,
    @Ctx() context: IContext,
    @PubSub() pubSub: PubSubEngine
  ): Promise<boolean> {
    authorizeService(context);

    try {
      const vehicle = await context.db.getVehicle(undefined, input.id);
      await context.logic.updateVehicleData(input);
      await pubSub.publish(SubscriptionTopic.VehicleUpdate, {
        vehicle_uuid: vehicle.vehicle_uuid,
        account_uuid: vehicle.account_uuid,
      });
      return true;
    } catch (err) {
      log(LogLevel.Error, err);
      return false;
    }
  }

  @Mutation((_returns) => Int, { nullable: true })
  async _chargeCalibration(
    @Arg("vehicleID", (_type) => ID) vehicle_uuid: string,
    @Arg("level", (_type) => Int, { nullable: true }) level: number,
    @Arg("duration", (_type) => Int, { nullable: true, description: `duration (seconds)` })
      duration: number,
    @Arg("powerUse", (_type) => Float, { nullable: true, description: `current power use (kW)` })
      powerUse: number,
    @Ctx() context: IContext
  ): Promise<number | null> {
    authorizeService(context);

    const vehicle = await context.db.getVehicle(undefined, vehicle_uuid);

    if (vehicle.charge_id === null) {
      // TODO: what happens if it just stopped charging? should charge_id be sent with the query instead?
      throw new GraphQLError(
        "sending _chargeCalibration on a vehicle not charging",
        undefined, undefined, undefined, undefined, undefined, { code: "BAD_USER_INPUT" }
      );
    }

    if (!level || !duration) {
      return await context.db.chargeCalibration(vehicle.vehicle_uuid, vehicle.charge_id);
    } else {
      const energy = (duration * powerUse * 1e3) / 60; // kWs => Ws => Wm
      const result = await context.db.setChargeCurve(
        vehicle.vehicle_uuid,
        vehicle.charge_id,
        level,
        duration,
        undefined,
        energy,
        energy
      );
      await context.logic.refreshChargePlan(vehicle.vehicle_uuid);
      return result.level;
    }
  }

  @Mutation((_returns) => Boolean)
  async _updatePrice(
    @Arg("input") input: UpdatePriceInput,
    @Ctx() context: IContext
  ): Promise<boolean> {
    authorizeService(context);
    for (const point of input.prices) {
      await context.db.updatePriceData(input.priceListID, point.startAt, point.price);
    }
    await context.logic.priceListRefreshed(input.priceListID);
    return true;
  }
}
