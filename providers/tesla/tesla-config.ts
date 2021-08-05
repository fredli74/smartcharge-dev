const config = {
  TESLA_API_BASE_URL: `https://owner-api.teslamotors.com/`,
  TESLA_API_PROXY: undefined,
  TESLA_AUTH_BASE_URL: `https://auth.tesla.com/oauth2/v3/`,
  TESLA_CLIENT_ID: `81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384`,
  TESLA_CLIENT_SECRET: `c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3`,
  TESLA_API_HEADERS: {
    "User-Agent": `curl/7.64.1`
    //    "x-tesla-user-agent": `TeslaApp/3.10.9-433/adff2e065/android/10`,
    //    "X-Requested-With": "com.teslamotors.tesla"
  },
  /*
    User agent was ${PROJECT_AGENT} ${provider.name}/${provider.version}`,
    then we had to use `curl/7.64.1`, but now we are fully faking it
  */
  TOKEN_EXPIRATION_WINDOW: 300, // Pre-expiration Tesla API token renewal window

  TIME_BEFORE_TIRED: 20 * 60e3, // stay online 20 min after a drive or charge
  TIME_BEING_TIRED: 30 * 60e3, // try counting sheep for 30 minutes
  TRIP_HVAC_ON_WINDOW: 15 * 60e3, // turn HVAC on 15 minutes before trip start
  TRIP_HVAC_ON_DURATION: 20 * 60e3, // turn HVAC off 20 minutes after scheduled trip start

  TESLA_POLL_INTERVAL: 120,

  DEFAULT_MINIMUM_LEVEL: 30,
  DEFAULT_MAXIMUM_LEVEL: 90,

  LOWEST_POSSIBLE_CHARGETO: 50,

  AGENT_SAVE_TO_TRACEFILE: false,
  AGENT_TRACE_FILENAME: "logs/tesla_trace.log"
};
if (process && process.env) {
  for (const key of Object.keys(config)) {
    if (process.env[key] !== undefined) {
      (config as any)[key] = process.env[key];
    }
  }
}

export default config;
