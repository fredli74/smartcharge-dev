/**
 * @file config loader for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { DEFAULT_PORT } from "./smartcharge-defines.js";

// Utility to get environment variables from Vite or Node.js
function getEnvVar(key: string, defaultValue: string) {
  const viteKey = `VITE_${key}`;
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[viteKey] !== undefined) {
    return import.meta.env[viteKey];
  }
  if (typeof process !== 'undefined' && process.env && process.env[viteKey] !== undefined) {
    return process.env[viteKey];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return process.env[key];
  }
  return defaultValue;
}


// Config object
const config = {
  POSTGRES_DB: getEnvVar('POSTGRES_DB', `smartcharge`),
  POSTGRES_USER: getEnvVar('POSTGRES_USER', `scserver`),
  POSTGRES_PASSWORD: getEnvVar('POSTGRES_PASSWORD', `scserverpass`),
  POSTGRES_HOST: getEnvVar('POSTGRES_HOST', `db`),
  POSTGRES_PORT: getEnvVar('POSTGRES_PORT', `${5432}`),
  POSTGRES_SSL: getEnvVar('POSTGRES_SSL', `${false}`),
  POSTGRES_CONNECTIONS: getEnvVar('POSTGRES_CONNECTIONS', `${10}`),
  PUBLIC_URL: getEnvVar('PUBLIC_URL', ``),
  HELP_URL: getEnvVar('HELP_URL', `https://github.com/fredli74/smartcharge-dev/issues`),
  SERVER_IP: getEnvVar('SERVER_IP', `0.0.0.0`),
  SERVER_PORT: getEnvVar('SERVER_PORT', `${DEFAULT_PORT}`),
  SINGLE_USER: getEnvVar('SINGLE_USER', `${true}`),
  SINGLE_USER_PASSWORD: getEnvVar('SINGLE_USER_PASSWORD', `password`),
  AUTH0_DOMAIN: getEnvVar('AUTH0_DOMAIN', `smartcharge.eu.auth0.com`),
  AUTH0_CLIENT_ID: getEnvVar('AUTH0_CLIENT_ID', `WGPO7jrY6Sd0HcfkVvTetyrEnpsE8RQM`),
  GLOBAL_INFO_MESSAGE: getEnvVar('GLOBAL_INFO_MESSAGE', ``),
  GLOBAL_WARNING_MESSAGE: getEnvVar('GLOBAL_WARNING_MESSAGE', ``),
  GLOBAL_ERROR_MESSAGE: getEnvVar('GLOBAL_ERROR_MESSAGE', ``),
};

export default config;
