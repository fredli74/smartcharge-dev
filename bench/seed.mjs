// Seeds the bench database by replaying four days of two simulated vehicles through the real Logic,
// so stats, charge sessions and charge plans come from production code. Run with --import ./clock.mjs.
import { strict as assert } from "node:assert";
import * as S from "./scenario.mjs";

const { DBInterface, SINGLE_USER_UUID } = await import("../dist/server/db-interface.js");
const { Logic } = await import("../dist/server/logic.js");
const { numericStartTime, numericStopTime } = await import("../dist/shared/utils.js");

const db = new DBInterface();
await db.init();
const logic = new Logic(db);

// Stockholm winter time; the scenario never crosses a DST change.
const localHour = (t) => ((t / 3600e3 + 1) % 24 + 24) % 24;

// Fixed rows, with fixed ids so snapshots and URLs are stable
await db.pg.none(`UPDATE account SET api_token = $1 WHERE account_uuid = $2;`, [S.TOKEN, SINGLE_USER_UUID]);
await db.pg.none(`INSERT INTO service_provider(service_uuid, account_uuid, provider_name) VALUES($1, $2, 'tesla');`,
  [S.SERVICE_ID, SINGLE_USER_UUID]);
await db.newPriceList(SINGLE_USER_UUID, "Bench SE3", false, S.PRICE_LIST_ID);
for (const [loc, priceList] of [[S.HOME, S.PRICE_LIST_ID], [S.WORK, null]]) {
  await db.pg.none(
    `INSERT INTO location(location_uuid, account_uuid, name, location_micro_latitude, location_micro_longitude, radius, price_list_uuid)
      VALUES($1, $2, $3, $4, $5, 250, $6);`,
    [loc.id, SINGLE_USER_UUID, loc.name, loc.latitude * 1e6, loc.longitude * 1e6, priceList]
  );
}
// The status text is the provider agent's; without one the app lists a vehicle as not polled yet
for (const v of [S.ALPHA, S.BETA]) {
  await db.pg.none(
    `INSERT INTO vehicle(vehicle_uuid, account_uuid, service_uuid, name, maximum_charge, provider_data, status)
      VALUES($1, $2, $3, $4, 80, $5, $6);`,
    [v.id, SINGLE_USER_UUID, S.SERVICE_ID, v.name, { provider: "tesla", car_type: "model3" }, v.status]
  );
}

// 15-minute prices (SEK/kWh): cheap nights, morning and evening peaks, a different level every day
for (let t = S.PRICES_FROM; t <= S.PRICES_TO; t += 15 * 60e3) {
  const h = localHour(t);
  const shape = h < 1 ? 0.3 : h < 5 ? 0 : h < 7 ? 0.4 : h < 9 ? 1 : h < 17 ? 0.5 : h < 20 ? 1.2 : 0.6;
  const day = Math.floor(t / 86400e3);
  await db.updatePriceData(S.PRICE_LIST_ID, new Date(t), +(0.35 + 0.6 * shape + 0.05 * (day % 5) + 0.01 * ((t / 900e3) % 4)).toFixed(4));
}

// Where each vehicle is at local time t: [from, to] while driving, a place when parked
function itinerary(vehicle, t) {
  const h = localHour(t);
  const day = new Date(t + 3600e3).getUTCDay(); // 0 = Sunday
  if (vehicle === S.ALPHA) {
    // Commutes Monday to Wednesday (a half day on Wednesday brings it home at the anchor, 14:30) and makes a
    // weekend outing to Work; the replay has no Thursday or Friday
    const [leave, back] = day >= 1 && day <= 3 ? [7.5, day === 3 ? 14 : 16] : [11, 13];
    if (h >= leave && h < leave + 0.5) return [S.HOME, S.WORK];
    if (h >= leave + 0.5 && h < back) return S.WORK;
    if (h >= back && h < back + 0.5) return [S.WORK, S.HOME];
    return S.HOME;
  }
  // Beta stays home until Wednesday noon, then drives off and parks away from any known location
  if (day === 3 && h >= 12 && h < 12.5) return [S.HOME, S.AWAY];
  if (day === 3 && h >= 12.5) return S.AWAY;
  return S.HOME;
}

const sim = new Map([
  [S.ALPHA, { level: 70, odometer: 12_000_000, energyAdded: 0, driveStart: 0 }],
  [S.BETA, { level: 60, odometer: 34_000_000, energyAdded: 0, driveStart: 0 }],
]);

for (let t = S.REPLAY_FROM; t <= S.ANCHOR; t += S.TICK_MS) {
  globalThis.benchSetNow(t);
  for (const [vehicle, state] of sim) {
    const where = itinerary(vehicle, t);
    const driving = Array.isArray(where);
    let position = where;
    if (driving) {
      state.driveStart ||= t;
      const f = Math.min(1, (t - state.driveStart) / (30 * 60e3));
      position = {
        latitude: where[0].latitude + (where[1].latitude - where[0].latitude) * f,
        longitude: where[0].longitude + (where[1].longitude - where[0].longitude) * f,
      };
      state.level -= 2;
      state.odometer += 4000;
    } else {
      state.driveStart = 0;
    }
    const connected = position === S.HOME;
    if (!connected) state.energyAdded = 0;

    // Charge like the car would: follow the active window of the plan the server made
    const { charge_plan } = await db.getVehicle(undefined, vehicle.id);
    const active = connected && (charge_plan || []).find((p) =>
      numericStartTime(p.chargeStart) <= t && t < numericStopTime(p.chargeStop) && state.level < p.level);
    if (active) {
      state.level += 1;
      state.energyAdded += (11 * S.TICK_MS) / 3600e3;
    }

    const h = localHour(t);
    await logic.updateVehicleData({
      id: vehicle.id,
      geoLocation: { latitude: position.latitude, longitude: position.longitude },
      batteryLevel: state.level,
      odometer: state.odometer,
      outsideTemperature: Math.round(-2 - 3 * Math.cos((2 * Math.PI * (h - 15)) / 24)),
      insideTemperature: driving ? 20 : 12,
      climateControl: driving,
      isDriving: driving,
      connectedCharger: connected ? "ac" : null,
      chargingTo: active ? active.level : null,
      estimatedTimeLeft: active ? (active.level - state.level) * 5 : null,
      powerUse: active ? 11 : driving ? 15 : null,
      energyAdded: connected ? +state.energyAdded.toFixed(2) : null,
    });
  }
}
assert(Date.now() === S.ANCHOR, "the replay must end exactly at the anchor");
process.exit(0); // DBInterface starts a maintenance interval that would keep the seed alive
