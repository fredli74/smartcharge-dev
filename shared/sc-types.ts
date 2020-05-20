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
  Manual = "manual",
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
  /**
   * Auto generated charge target
   */
  AI = "ai",
  /**
   * Alternative AI charge target
   */
  Suggestion = "suggestion",
  /**
   * Manual charge entry
   */
  Manual = "manual",
  /**
   * Disable all vehicle control
   */
  Disable = "disable",
  /**
   * Charge for upcoming trip
   */
  Trip = "trip"
}
