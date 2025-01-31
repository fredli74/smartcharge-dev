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
  TESLA_AUTH_BASE_URL: process.env.TESLA_AUTH_BASE_URL || "https://auth.tesla.com/",
  TESLA_AUTH_PROXY: process.env.TESLA_AUTH_PROXY || "",

  TESLA_CLIENT_ID: process.env.TESLA_CLIENT_ID || "*** REQUIRED IN .env ***", // Tesla Developer App credentials
  TESLA_CLIENT_SECRET: process.env.TESLA_CLIENT_SECRET || "*** REQUIRED IN .env ***", // Tesla Developer App credentials
  TOKEN_EXPIRATION_WINDOW: parseNumber(process.env.TOKEN_EXPIRATION_WINDOW, 300), // Pre-expiration Tesla API token renewal window

  TIME_BEFORE_TIRED: parseNumber(process.env.TIME_BEFORE_TIRED, 20 * 60e3), // stay online 20 min after a drive or charge
  TIME_BEING_TIRED: parseNumber(process.env.TIME_BEING_TIRED, 30 * 60e3), // try counting sheep for 30 minutes
  TRIP_HVAC_ON_WINDOW: parseNumber(process.env.TRIP_HVAC_ON_WINDOW, 15 * 60e3), // turn HVAC on 15 minutes before trip start
  TRIP_HVAC_ON_DURATION: parseNumber(process.env.TRIP_HVAC_ON_DURATION, 20 * 60e3), // turn HVAC off 20 minutes after scheduled trip start

  TESLA_POLL_INTERVAL: parseNumber(process.env.TESLA_POLL_INTERVAL, 60 * 60), // 60 minutes minimum on new API restrictions

  DEFAULT_MINIMUM_LEVEL: parseNumber(process.env.DEFAULT_MINIMUM_LEVEL, 30),
  DEFAULT_MAXIMUM_LEVEL: parseNumber(process.env.DEFAULT_MAXIMUM_LEVEL, 90),

  LOWEST_POSSIBLE_CHARGETO: parseNumber(process.env.LOWEST_POSSIBLE_CHARGETO, 50),
};
export default config;
