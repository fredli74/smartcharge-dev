// Fixed facts of the regression bench scenario, shared by the seed, the server setup and the specs.

// Wednesday 14:30 in Stockholm (winter time): tomorrow's prices are out, the evening has not started.
export const ANCHOR = Date.parse("2026-01-14T13:30:00Z");
export const REPLAY_FROM = ANCHOR - 4 * 24 * 60 * 60e3;
export const TICK_MS = 5 * 60e3;
// Prices cover three weeks of history (weekly averages) up to the end of the anchor's next day.
export const PRICES_FROM = ANCHOR - 25 * 24 * 60 * 60e3;
export const PRICES_TO = Date.parse("2026-01-15T23:00:00Z");

// Outside 3000-3010: that range is published to the host and shared by every session's dev servers.
export const SERVER_PORT = 54330;
export const BASE_URL = `http://localhost:${SERVER_PORT}`;
// The server accepts exactly 64 characters after "Bearer ".
export const TOKEN = "bench".padEnd(64, "0");

export const SERVICE_ID = "00000000-0000-4000-8000-000000000001";
export const PRICE_LIST_ID = "00000000-0000-4000-8000-000000000002";
export const HOME = { id: "00000000-0000-4000-8000-000000000003", name: "Home", latitude: 59.3, longitude: 18.0 };
export const WORK = { id: "00000000-0000-4000-8000-000000000004", name: "Work", latitude: 59.33, longitude: 18.06 };
export const AWAY = { latitude: 59.4, longitude: 17.9 }; // not a known location

// Alpha commutes and is plugged in at home at the anchor; Beta ends the replay parked away from any location.
export const ALPHA = { id: "00000000-0000-4000-8000-000000000010", name: "Bench Alpha", status: "Online (wifi)" };
export const BETA = { id: "00000000-0000-4000-8000-000000000011", name: "Bench Beta", status: "Sleeping" };
