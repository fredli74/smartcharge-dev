const parseNumber = (value: string | undefined, defaultValue: number): number =>
  value ? parseInt(value, 10) : defaultValue;

const config = {
  TESLA_COMMAND_PROXY: process.env.TESLA_COMMAND_PROXY || "http://tesla-vc", // e.g., 'https://user:pass@localhost:4443'

  TESLA_TELEMETRY_HOST: process.env.TESLA_TELEMETRY_HOST || "", // public hostname
  TESLA_TELEMETRY_PORT: parseNumber(process.env.TESLA_TELEMETRY_PORT, 443),
  TESLA_TELEMETRY_CA: process.env.TESLA_TELEMETRY_CA || "*** REQUIRED IN .env ***", // "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n",
  TESLA_TELEMETRY_KAFKA_BROKER: process.env.TESLA_TELEMETRY_KAFKA_BROKER || "kafka:9092",

  TESLA_API_BASE_URL: process.env.TESLA_API_BASE_URL || "https://fleet-api.prd.eu.vn.cloud.tesla.com",
  TESLA_API_PROXY: process.env.TESLA_API_PROXY || "",
  // Use fleet-auth for token exchange (/oauth2/v3/token) for higher rate limits.
  // The authorize redirect stays on auth.tesla.com (see providers/tesla/app/tesla.vue).
  TESLA_AUTH_BASE_URL: process.env.TESLA_AUTH_BASE_URL || "https://fleet-auth.prd.vn.cloud.tesla.com/",
  TESLA_AUTH_PROXY: process.env.TESLA_AUTH_PROXY || "",

  TESLA_CLIENT_ID: process.env.TESLA_CLIENT_ID || "*** REQUIRED IN .env ***", // Tesla Developer App credentials
  TESLA_CLIENT_SECRET: process.env.TESLA_CLIENT_SECRET || "*** REQUIRED IN .env ***", // Tesla Developer App credentials
  TESLA_TOKEN_EXPIRATION_WINDOW: parseNumber(process.env.TESLA_TOKEN_EXPIRATION_WINDOW, 300), // Pre-expiration Tesla API token renewal window

  TESLA_DEFAULT_MAX_LEVEL: parseNumber(process.env.TESLA_DEFAULT_MAX_LEVEL, 90),
  TESLA_LOWEST_POSSIBLE_CHARGETO: parseNumber(process.env.TESLA_LOWEST_POSSIBLE_CHARGETO, 50),
};
export default config;
