/**
 * @file Defines for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

export const PROJECT_NAME = "SmartCharge";
export const PROJECT_VERSION = "1.0";
export const PROJECT_AGENT = `${PROJECT_NAME}/${PROJECT_VERSION} (+...)`;
export const API_PATH = "/api/gpl";
export const DEFAULT_PORT = 3000;

export const DEFAULT_LOCATION_RADIUS = 250; // Default geo fence radius in meters
export const DEFAULT_DIRECTLEVEL = 15; // Default direct level if no setting for location

export const TRIP_TOPUP_MARGIN = 15 * 60e3; // 15 minutes before trip time
export const MIN_STATS_PERIOD = 1 * 60e3; // 1 minute
