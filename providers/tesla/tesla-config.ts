import provider from "./index";

const config = {
  TESLA_API_BASE_URL: `https://owner-api.teslamotors.com/`,
  TESLA_CLIENT_ID: `81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384`,
  TESLA_CLIENT_SECRET: `c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3`,

  TIME_BEFORE_TIRED: 20 * 60e3, // stay online 20 min after a drive or charge
  TIME_BEING_TIRED: 30 * 60e3, // try counting sheep for 30 minutes
  HVAC_ON_BEFORE_TRIP: 10 * 60e3, // turn HVAC on 10 minutes before trip

  DEFAULT_MINIMUM_LEVEL: 30,
  DEFAULT_MAXIMUM_LEVEL: 90,

  DEFAULT_CHARGE_REMINDER: 50,

  AGENT_SAVE_TO_TRACEFILE: true,
  AGENT_TRACE_FILENAME: "../../logs/tesla_trace.log"
};

export default config;
