/**
 * @file GraphQL API Vehicle types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import "reflect-metadata";
import {
  Field,
  ObjectType,
  InputType,
  Int,
  ID,
  registerEnumType,
  Float,
  Resolver,
  FieldResolver,
  Root,
  Ctx,
  GraphQLISODateTime,
} from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";
import { GeoLocation, Location } from "./location-type";
import {
  SmartChargeGoal,
  ChargeType,
  ChargeConnection,
  ScheduleType,
} from "@shared/sc-types";
import { DBVehicle, DBSchedule } from "@server/db-schema";
import { plainToInstance, Type } from "class-transformer";
import { IContext } from "./api";
import { LocationResolver } from "./location-resolver";
import { DBInterface } from "@server/db-interface";

/*******************************
 *    VehicleLocationSetting   *
 *******************************/

@ObjectType("VehicleLocationSetting")
@InputType("VehicleLocationSettingInput")
export class VehicleLocationSettings {
  @Field((_type) => ID, { description: `location id` })
  locationID!: string;
  @Field((_type) => Int, {
    description: `Minimum battery level to reach directly (%)`,
  })
  directLevel!: number;
  @Field((_type) => String)
  goal!: SmartChargeGoal | string;
}
// Not used because we cannot union between enum and String in type-graphql
registerEnumType(SmartChargeGoal, {
  name: "SmartChargeGoal",
  description: "Smart Charge Goal Presets",
});

/*******************************
 *         ChargePlan          *
 *******************************/

registerEnumType(ChargeType, { name: "ChargeType" });

@ObjectType()
export class ChargePlan {
  @Field((_type) => ChargeType)
  chargeType!: ChargeType;
  @Type(() => Date)
  @Field((_type) => GraphQLISODateTime, {
    nullable: true,
    description: `time to start or null for now`,
  })
  chargeStart!: Date | null;
  @Type(() => Date)
  @Field((_type) => GraphQLISODateTime, {
    nullable: true,
    description: `time to end or null for never`,
  })
  chargeStop!: Date | null;
  @Field((_type) => Int)
  level!: number;
  @Field((_type) => String)
  comment!: string;
}

/*******************************
 *          Schedule           *
 *******************************/

registerEnumType(ScheduleType, { name: "ScheduleType" });

@ObjectType()
export class Schedule extends DBSchedule {}

@Resolver((_of) => Schedule)
export class ScheduleTypeResolver {
  @FieldResolver((_returns) => Int)
  id(@Root() schedule: Schedule): number {
    return schedule.schedule_id;
  }
  @FieldResolver((_returns) => ID)
  vehicleID(@Root() schedule: Schedule): string {
    return schedule.vehicle_uuid;
  }
  @FieldResolver((_returns) => ScheduleType)
  type(@Root() schedule: Schedule): ScheduleType {
    return schedule.schedule_type as ScheduleType;
  }
  @FieldResolver((_returns) => Int, { nullable: true })
  level(@Root() schedule: Schedule): number | null {
    return schedule.level;
  }
  @FieldResolver((_returns) => GraphQLISODateTime, { nullable: true })
  time(@Root() schedule: Schedule): Date | null {
    return schedule.schedule_ts;
  }
}

/*******************************
 *           Vehicle           *
 *******************************/

@ObjectType()
export class Vehicle extends DBVehicle {}

@Resolver((_of) => Vehicle)
export class VehicleTypeResolver {
  @FieldResolver((_returns) => ID)
  id(@Root() vehicle: Vehicle): string {
    return vehicle.vehicle_uuid;
  }
  @FieldResolver((_returns) => ID)
  ownerID(@Root() vehicle: Vehicle): string {
    return vehicle.account_uuid;
  }
  @FieldResolver((_returns) => ID, { nullable: true })
  serviceID(@Root() vehicle: Vehicle): string | null {
    return vehicle.service_uuid;
  }
  @FieldResolver((_returns) => String)
  name(@Root() vehicle: Vehicle): string {
    return vehicle.name;
  }
  @FieldResolver((_returns) => Int, {
    description: `maximum level to charge to unless a trip is scheduled (%)`,
  })
  maximumLevel(@Root() vehicle: Vehicle): number {
    return vehicle.maximum_charge;
  }
  @FieldResolver((_returns) => GraphQLJSONObject)
  providerData(@Root() vehicle: Vehicle): any {
    return vehicle.provider_data;
  }
  @FieldResolver((_returns) => GeoLocation, { nullable: true })
  geoLocation(@Root() vehicle: Vehicle): GeoLocation | null {
    if (
      vehicle.location_micro_latitude === null ||
      vehicle.location_micro_longitude === null
    ) {
      return null;
    }
    return {
      latitude: vehicle.location_micro_latitude / 1e6,
      longitude: vehicle.location_micro_longitude / 1e6,
    };
  }
  @FieldResolver((_returns) => ID, {
    nullable: true,
    description: `known location id`,
  })
  locationID(@Root() vehicle: Vehicle): string | null {
    return vehicle.location_uuid;
  }
  @FieldResolver((_returns) => Location, {
    nullable: true,
    description: `known location`,
  })
  async location(
    @Root() vehicle: Vehicle,
    @Ctx() context: IContext
  ): Promise<Location | null> {
    if (vehicle.location_uuid === null) {
      return null;
    }
    return new LocationResolver().location(vehicle.location_uuid, context);
  }
  @FieldResolver((_returns) => [Schedule], { description: `schedule` })
  async schedule(
    @Root() vehicle: Vehicle,
    @Ctx() context: IContext
  ): Promise<Schedule[]> {
    return plainToInstance(
      Schedule,
      await context.db.getSchedule(vehicle.vehicle_uuid)
    );
  }
  @FieldResolver((_returns) => [VehicleLocationSettings], {
    description: `location settings`,
  })
  locationSettings(@Root() vehicle: Vehicle): VehicleLocationSettings[] {
    return plainToInstance(
      VehicleLocationSettings,
      Object.entries(vehicle.location_settings).map(
        ([key, values]: [
          string,
          Partial<VehicleLocationSettings>
        ]): VehicleLocationSettings => ({
          ...DBInterface.DefaultVehicleLocationSettings(key),
          ...values,
        })
      )
    );
  }
  @FieldResolver((_returns) => Int, { description: `battery level (%)` })
  batteryLevel(@Root() vehicle: Vehicle): number {
    return vehicle.level;
  }
  @FieldResolver((_returns) => Int, { description: `odometer (meters)` })
  odometer(@Root() vehicle: Vehicle): number {
    return vehicle.odometer;
  }
  @FieldResolver((_returns) => Float, {
    description: `outside temperature (celcius)`,
  })
  outsideTemperature(@Root() vehicle: Vehicle): number {
    return vehicle.outside_deci_temperature / 10;
  }
  @FieldResolver((_returns) => Float, {
    description: `inside temperature (celcius)`,
  })
  insideTemperature(@Root() vehicle: Vehicle): number {
    return vehicle.inside_deci_temperature / 10;
  }
  @FieldResolver((_returns) => Boolean, {
    description: `is climate control on`,
  })
  climateControl(@Root() vehicle: Vehicle): boolean {
    return vehicle.climate_control;
  }
  @FieldResolver((_returns) => Boolean, {
    description: `is a charger connected`,
  })
  isConnected(@Root() vehicle: Vehicle): boolean {
    return vehicle.connected;
  }
  @FieldResolver((_returns) => Int, {
    nullable: true,
    description: `charging to level (%)`,
  })
  chargingTo(@Root() vehicle: Vehicle): number | null {
    return vehicle.charging_to;
  }
  @FieldResolver((_returns) => Int, {
    nullable: true,
    description: `estimated time to complete charge (minutes)`,
  })
  estimatedTimeLeft(@Root() vehicle: Vehicle): number | null {
    return vehicle.estimate;
  }
  @FieldResolver((_returns) => Boolean)
  isDriving(@Root() vehicle: Vehicle): boolean {
    return vehicle.driving;
  }
  @FieldResolver((_returns) => String)
  status(@Root() vehicle: Vehicle): string {
    return vehicle.status;
  }
  @FieldResolver((_returns) => String)
  smartStatus(@Root() vehicle: Vehicle): string {
    return vehicle.smart_status;
  }
  @FieldResolver((_returns) => [ChargePlan], {
    nullable: true,
    description: `charge plan`,
  })
  chargePlan(@Root() vehicle: Vehicle): ChargePlan[] | null {
    if (vehicle.charge_plan === null) {
      return null;
    }
    return (vehicle.charge_plan as ChargePlan[]).map((f) =>
      plainToInstance(ChargePlan, f)
    );
  }
  @FieldResolver((_returns) => GraphQLISODateTime)
  updated(@Root() vehicle: Vehicle): Date {
    return vehicle.updated;
  }
}

/*******************************
 *        UpdateClasses        *
 *******************************/

@InputType()
export abstract class UpdateVehicleInput {
  @Field((_type) => ID)
  id!: string;
  @Field((_type) => String, { nullable: true })
  name?: string;
  @Field((_type) => Int, { nullable: true })
  maximumLevel?: number;
  @Field((_type) => [VehicleLocationSettings], { nullable: true })
  locationSettings?: VehicleLocationSettings[];
  @Field((_type) => String, { nullable: true })
  status?: string;
  @Field((_type) => ID, { nullable: true })
  serviceID?: string;
  @Field((_type) => GraphQLJSONObject, { nullable: true })
  providerData?: any;
}

registerEnumType(ChargeConnection, { name: "ChargeConnection" });

@InputType()
export abstract class UpdateVehicleDataInput {
  @Field((_type) => ID)
  id!: string;
  @Field((_type) => GeoLocation)
  geoLocation!: GeoLocation;
  @Field((_type) => Int, { description: `battery level (%)` })
  batteryLevel!: number;
  @Field((_type) => Int, { description: `odometer (meters)` })
  odometer!: number;
  @Field((_type) => Float, {
    nullable: true,
    description: `outside temperature (celcius)`,
  })
  outsideTemperature!: number | null;
  @Field((_type) => Float, {
    nullable: true,
    description: `inside temperature (celcius)`,
  })
  insideTemperature!: number | null;
  @Field({ description: `is climate control on` })
  climateControl!: boolean;
  @Field((_type) => Boolean)
  isDriving!: boolean;
  @Field((_type) => ChargeConnection, {
    nullable: true,
    description: `charge connection`,
  })
  connectedCharger!: ChargeConnection | null;
  @Field((_type) => Int, {
    nullable: true,
    description: `charging to level (%)`,
  })
  chargingTo!: number | null;
  @Field((_type) => Int, {
    nullable: true,
    description: `estimated time to complete charge (minutes)`,
  })
  estimatedTimeLeft!: number | null;
  @Field((_type) => Float, {
    nullable: true,
    description: `current power use (kW)`,
  })
  powerUse!: number | null;
  @Field((_type) => Float, {
    nullable: true,
    description: `charge added (kWh)`,
  })
  energyAdded!: number | null;
}

@InputType()
export abstract class VehicleDebugInput {
  @Field((_type) => ID)
  id!: string;
  @Field((_type) => GraphQLISODateTime)
  timestamp!: Date;
  @Field((_type) => String)
  category!: string;
  @Field((_type) => GraphQLJSONObject)
  data!: any;
}
