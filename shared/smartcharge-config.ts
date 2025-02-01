/**
 * @file config loader for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { ConfigType } from "./sc-types.js";
import { DEFAULT_PORT } from "./smartcharge-defines.js";

// Config object
const config: ConfigType = {
  POSTGRES_URL: process.env.POSTGRES_URL || `postgres://scserver:scserver@postgres:5432/smartcharge`,
  POSTGRES_SSL: process.env.POSTGRES_SSL === "true",
  POSTGRES_CONNECTIONS: parseInt(process.env.POSTGRES_CONNECTIONS || `10`),
  PUBLIC_URL: process.env.PUBLIC_URL || ``,
  HELP_URL: process.env.HELP_URL || `https://github.com/fredli74/smartcharge-dev/issues`,
  SERVER_IP: process.env.SERVER_IP || `::`,
  SERVER_PORT: parseInt(process.env.SERVER_PORT || `${DEFAULT_PORT}`),
  SINGLE_USER: process.env.SINGLE_USER ? process.env.SINGLE_USER === "true" : true,
  SINGLE_USER_PASSWORD: process.env.SINGLE_USER_PASSWORD || "password",
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN || `smartcharge.eu.auth0.com`,
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID || `WGPO7jrY6Sd0HcfkVvTetyrEnpsE8RQM`,
  GLOBAL_INFO_MESSAGE: process.env.GLOBAL_INFO_MESSAGE || ``,
  GLOBAL_WARNING_MESSAGE: process.env.GLOBAL_WARNING_MESSAGE || ``,
  GLOBAL_ERROR_MESSAGE: process.env.GLOBAL_ERROR_MESSAGE || ``,
  TESLA_VIRTUAL_KEY_URL: process.env.TESLA_VIRTUAL_KEY_URL || ``,
};

export default config;
