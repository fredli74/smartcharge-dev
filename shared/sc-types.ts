/**
 * @file Shared server and client types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

export enum EventType {
  Sleep = "sleep",
  // Idle = "idle",
  Charge = "charge",
  Trip = "trip",
}

export enum SmartChargeGoal {
  Low = "low",
  Balanced = "balanced",
  Full = "full",
}

export enum ChargeType {
  Disable = "disable",
  Calibrate = "calibrate",
  Minimum = "minimum",
  Manual = "manual",
  Trip = "trip",
  Routine = "routine",
  Prefered = "prefered",
  Fill = "fill",
}

export enum ChargeConnection {
  AC = "ac",
  DC = "dc",
}

export enum DisableType {
  Nothing = 0,
  Control = 1,
  Everything = 2,
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
  Trip = "trip",
}

export interface ConfigType {
  POSTGRES_URL: string;
  POSTGRES_SSL: boolean;
  POSTGRES_CONNECTIONS: number;
  PUBLIC_URL: string;
  HELP_URL: string;
  SERVER_IP: string;
  SERVER_PORT: number;
  SINGLE_USER: boolean;
  SINGLE_USER_PASSWORD: string;
  AUTH0_DOMAIN: string;
  AUTH0_CLIENT_ID: string;
  GLOBAL_INFO_MESSAGE: string;
  GLOBAL_WARNING_MESSAGE: string;
  GLOBAL_ERROR_MESSAGE: string;
  TESLA_VIRTUAL_KEY_URL: string;
}
