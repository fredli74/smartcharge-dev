import equal from "fast-deep-equal";
import {
  GQLVehicleLocationSetting,
  GQLSchedule,
  GQLVehicle
} from "@shared/sc-schema";
import { DEFAULT_DIRECTLEVEL } from "@shared/smartcharge-defines";
import { SmartChargeGoal } from "@shared/sc-types";
import { compareStartTimes } from "@shared/utils";

/* TODO REMOVE */
export function diff(objFrom: any, objTo: any, deep?: boolean): any {
  if (typeof objTo === "object" && !Array.isArray(objTo)) {
    const result: any = {};
    for (let key of Object.keys(objFrom)) {
      if (objTo[key] === undefined) {
        result[key] = undefined;
      }
    }
    for (let key of Object.keys(objTo)) {
      if (!equal(objFrom[key], objTo[key])) {
        if (deep) {
          result[key] = diff(objFrom[key], objTo[key], deep);
        } else {
          result[key] = objTo[key];
        }
      }
    }
    return result;
  }
  return objTo;
}

export function scheduleMap(
  schedule: GQLSchedule[]
): Record<string, GQLSchedule> {
  return schedule
    .map(f => {
      f.time = f.time && new Date(f.time);
      return f;
    })
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
    goal: SmartChargeGoal.Balanced
  };
}

export function getVehicleLocationSettings(
  vehicle: GQLVehicle,
  locationID?: string
): GQLVehicleLocationSetting {
  const findID = locationID || vehicle.locationID || "";
  return (
    (vehicle.locationSettings &&
      vehicle.locationSettings.find(f => f.locationID === findID)) ||
    DefaultVehicleLocationSettings(findID)
  );
}
