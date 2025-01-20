/**
 * @file config loader for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { DEFAULT_PORT } from "./smartcharge-defines";

const config = {
  POSTGRES_DB: `smartcharge`,
  POSTGRES_USER: `scserver`,
  POSTGRES_PASSWORD: `scserverpass`,
  POSTGRES_HOST: `db`,
  POSTGRES_PORT: `${5432}`,
  POSTGRES_SSL: `${false}`,
  POSTGRES_CONNECTIONS: `${10}`,
  PUBLIC_URL: ``,
  HELP_URL: `https://github.com/fredli74/smartcharge-dev/issues`,
  SERVER_IP: `0.0.0.0`,
  SERVER_PORT: `${DEFAULT_PORT}`,
  SINGLE_USER: `${true}`,
  SINGLE_USER_PASSWORD: `password`,
  AUTH0_DOMAIN: `smartcharge.eu.auth0.com`,
  AUTH0_CLIENT_ID: `WGPO7jrY6Sd0HcfkVvTetyrEnpsE8RQM`,
  GLOBAL_INFO_MESSAGE: ``,
  GLOBAL_WARNING_MESSAGE: ``,
  GLOBAL_ERROR_MESSAGE: ``,
};

if (process && process.env) {
  for (const key of Object.keys(config)) {
    if (process.env[key] !== undefined) {
      (config as any)[key] = process.env[key];
    } else if (process.env[`VUE_APP_${key}`] !== undefined) {
      (config as any)[key] = process.env[`VUE_APP_${key}`];
    }
  }
}

export default config;
