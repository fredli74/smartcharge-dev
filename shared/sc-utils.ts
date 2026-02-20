/**
 * @file Client utilities for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import {
  GQLSchedule,
  GQLVehicleLocationSetting,
  GQLVehicle,
} from "./sc-schema.js";
import { compareStartTimes } from "./utils.js";
import { DEFAULT_DIRECTLEVEL } from "./smartcharge-defines.js";
import { SmartChargeGoal, SplitCharge } from "./sc-types.js";

export function scheduleMap(
  schedule: GQLSchedule[]
): Record<string, GQLSchedule> {
  return schedule
    .sort((a, b) => compareStartTimes(a.time, b.time))
    .reduce((map, obj) => {
      if (map[obj.type] === undefined) map[obj.type] = obj;
      return map;
    }, {} as Record<string, GQLSchedule>);
}

export function DefaultVehicleLocationSettings(
  location_uuid: string
): GQLVehicleLocationSetting {
  // NOTICE: There is a mirrored function for server side in db-interface.ts
  return {
    locationID: location_uuid,
    directLevel: DEFAULT_DIRECTLEVEL,
    goal: SmartChargeGoal.Balanced,
    splitCharge: SplitCharge.Auto,
  };
}

export function getVehicleLocationSettings(
  vehicle: GQLVehicle,
  locationID?: string
): GQLVehicleLocationSetting {
  const findID = locationID || vehicle.locationID || "";
  return (
    (vehicle.locationSettings &&
      vehicle.locationSettings.find((f) => f.locationID === findID)) ||
    DefaultVehicleLocationSettings(findID)
  );
}
