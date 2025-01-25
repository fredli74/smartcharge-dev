/**
 * @file Defines for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import globals from "./smartcharge-globals.json" assert { type: "json" };
export const API_PATH = globals.API_PATH;
export const DEFAULT_PORT = globals.DEFAULT_PORT;

export const PROJECT_NAME = "SmartCharge";
export const PROJECT_VERSION = "1.0";
export const PROJECT_AGENT = `https://github.com/fredli74/smartcharge-dev/${PROJECT_VERSION}`;

export const DEFAULT_LOCATION_RADIUS = 250; // Default geo fence radius in meters
export const DEFAULT_DIRECTLEVEL = 15; // Default direct level if no setting for location

export const SCHEDULE_TOPUP_MARGIN = 20 * 60e3; // 20 minutes before departure time
export const MIN_STATS_PERIOD = 1 * 60e3; // 1 minute
