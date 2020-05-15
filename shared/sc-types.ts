/**
 * @file Shared server and client types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

export enum SmartChargeGoal {
  Low = "low",
  Balanced = "balanced",
  Full = "full"
}

export enum ChargeType {
  Calibrate = "calibrate",
  Minimum = "minimum",
  Trip = "trip",
  Routine = "routine",
  Prefered = "prefered",
  Fill = "fill"
}

export enum ChargeConnection {
  AC = "ac",
  DC = "dc"
}

export enum DisableType {
  Nothing = 0,
  Control = 1,
  Everything = 2
}

export enum ScheduleType {
  Guide = "guide",
  Manual = "manual",
  Pause = "pause",
  Trip = "trip"
}
