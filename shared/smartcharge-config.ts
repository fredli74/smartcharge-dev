/**
 * @file config loader for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { DEFAULT_PORT } from "./smartcharge-defines";

const config = {
  DATABASE_URL: "postgres://scserver:scserverpass@localhost:5432/smartcharge",
  DATABASE_SSL: "false",
  PUBLIC_URL: "",
  SERVER_IP: "0.0.0.0",
  SERVER_PORT: `${DEFAULT_PORT}`,
  SINGLE_USER: "true",
  SINGLE_USER_PASSWORD: "password",
  AUTH0_DOMAIN: "smartcharge.eu.auth0.com",
  AUTH0_CLIENT_ID: "WGPO7jrY6Sd0HcfkVvTetyrEnpsE8RQM"
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
