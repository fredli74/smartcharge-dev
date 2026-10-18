import test from "node:test";
import assert from "node:assert/strict";

import {
  TeslaAgent,
  teslaSchedulePurposeCadenceMs,
  teslaScheduleRewriteIsMoot,
  teslaScheduleServesRequestedPurpose,
  teslaShouldMaintainRemoteHomeSchedule,
  teslaWantedSocLimit,
} from "../../dist/providers/tesla/tesla-agent.js";
import teslaAPI, { TeslaScheduleTimeToDate } from "../../dist/providers/tesla/tesla-api.js";
import { RestClientError } from "../../dist/shared/restclient.js";
import * as telemetryConnectivity from "../../dist/providers/tesla/telemetry-protos/vehicle_connectivity_pb.js";
import * as telemetryData from "../../dist/providers/tesla/telemetry-protos/vehicle_data_pb.js";

const location = {
  geoFenceRadius: 250,
  geoLocation: {
    latitude: 59.0,
    longitude: 18.0,
  },
};

const ts = (text) => new Date(text).getTime();
const iso = (t) => new Date(t).toISOString();

test("approach band accepts future blocker purpose with start drift inside fluid cadence", () => {
  const now = ts("2026-04-22T13:00:00Z");
  const existing = { chargeStart: ts("2026-04-22T15:00:00Z"), chargeStop: ts("2026-04-22T16:00:00Z") };
  const requested = { chargeStart: ts("2026-04-22T15:20:00Z"), chargeStop: ts("2026-04-22T20:00:00Z") };
  assert.equal(
    teslaScheduleServesRequestedPurpose(
      false,
      telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected,
      existing,
      requested,
      now,
      location,
      1_000,
      TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
      TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
    ),
    true
  );
});

test("immediate band accepts any future blocker schedule while still unplugged", () => {
  const now = ts("2026-04-22T13:00:00Z");
  const existing = { chargeStart: ts("2026-04-22T15:00:00Z"), chargeStop: ts("2026-04-22T16:00:00Z") };
  const requested = { chargeStart: ts("2026-04-22T20:00:00Z"), chargeStop: ts("2026-04-22T23:00:00Z") };
  assert.equal(
    teslaScheduleServesRequestedPurpose(
      false,
      telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected,
      existing,
      requested,
      now,
      location,
      100,
      TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
      TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
    ),
    true
  );
});

test("connected vehicle requires start time inside locked-in cadence", () => {
  const now = ts("2026-04-22T13:00:00Z");
  const matched = teslaScheduleServesRequestedPurpose(
    true,
    telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped,
    { chargeStart: ts("2026-04-22T20:03:00Z"), chargeStop: ts("2026-04-22T21:00:00Z") },
    { chargeStart: ts("2026-04-22T20:00:00Z"), chargeStop: ts("2026-04-22T23:00:00Z") },
    now,
    location,
    100,
    TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
    TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
  );
  const rejected = teslaScheduleServesRequestedPurpose(
    true,
    telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped,
    { chargeStart: ts("2026-04-22T20:10:00Z"), chargeStop: ts("2026-04-22T21:00:00Z") },
    { chargeStart: ts("2026-04-22T20:00:00Z"), chargeStop: ts("2026-04-22T23:00:00Z") },
    now,
    location,
    100,
    TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
    TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
  );
  assert.equal(matched, true);
  assert.equal(rejected, false);
});

test("active charging near stop time requires the correct stop time", () => {
  const now = ts("2026-04-22T13:56:00Z");
  const requested = { chargeStart: ts("2026-04-22T13:00:00Z"), chargeStop: ts("2026-04-22T14:00:00Z") };
  const matched = teslaScheduleServesRequestedPurpose(
    true,
    telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging,
    { chargeStart: ts("2026-04-22T13:00:00Z"), chargeStop: ts("2026-04-22T14:03:00Z") },
    requested,
    now,
    location,
    100,
    TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
    TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
  );
  const rejected = teslaScheduleServesRequestedPurpose(
    true,
    telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging,
    { chargeStart: ts("2026-04-22T13:00:00Z"), chargeStop: ts("2026-04-22T14:10:00Z") },
    requested,
    now,
    location,
    100,
    TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
    TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
  );
  assert.equal(matched, true);
  assert.equal(rejected, false);
});

test("remote home schedule maintenance is limited to the approach band", () => {
  assert.equal(
    teslaShouldMaintainRemoteHomeSchedule(false, location, 1_900, TeslaAgent.APPROACH_CHARGE_LOCATION_M),
    true
  );
  assert.equal(
    teslaShouldMaintainRemoteHomeSchedule(false, location, 2_100, TeslaAgent.APPROACH_CHARGE_LOCATION_M),
    false
  );
});

test("schedule cadence locks in when connected or inside the immediate band", () => {
  assert.equal(
    teslaSchedulePurposeCadenceMs(true, location, 10_000, TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS, TeslaAgent.FLUID_SCHEDULE_CADENCE_MS),
    TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS
  );
  assert.equal(
    teslaSchedulePurposeCadenceMs(false, location, 100, TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS, TeslaAgent.FLUID_SCHEDULE_CADENCE_MS),
    TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS
  );
  assert.equal(
    teslaSchedulePurposeCadenceMs(false, location, 1_000, TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS, TeslaAgent.FLUID_SCHEDULE_CADENCE_MS),
    TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
  );
});

test("missing wanted SOC means no charge-limit target", () => {
  assert.equal(teslaWantedSocLimit(undefined), null);
});

// A plugged-in, Stopped car at the location below its level; records the Tesla calls and the woken VINs.
const stoppedCar = (chargePlan, vehicleOverrides) => {
  const agent = Object.create(TeslaAgent.prototype);
  const calls = [];
  const wakes = [];
  agent.callTeslaAPI = async (_job, fn, vin, arg) => {
    calls.push({ fn, arg });
    if (fn === teslaAPI.wakeUp) wakes.push(vin);
    return { response: { state: "offline" } };
  };
  const vehicle = {
    vin: "TESTVIN0000000001",
    vehicleUUID: "00000000-0000-0000-0000-000000000001",
    isOnline: true,
    network: {},
    dbData: { isConnected: true, providerData: {}, schedule: [], chargePlan },
    charge_schedules: {},
    precondition_schedules: {},
    telemetryData: { Soc: 38, ChargeLimitSoc: 80, DetailedChargeState: telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped },
    ...vehicleOverrides,
  };
  // Like the server: updateVehicle returns the whole vehicle with the provider data merged in.
  agent.scClient = { updateVehicle: async (input) => ({ ...vehicle.dbData, providerData: { ...vehicle.dbData.providerData, ...input.providerData } }) };
  return { agent, calls, wakes, vehicle };
};

// An asleep car 20 minutes into a requested window without charging: the emergency wake case.
const blockedCharge = (onboardStartsInMs, chargeType = "Routine") => {
  const now = Date.now();
  const fixture = stoppedCar([{ chargeStart: iso(now - 20 * 60e3), chargeStop: iso(now + 3 * 60 * 60e3), chargeType, level: 80 }], { isOnline: false });
  if (onboardStartsInMs !== undefined) {
    fixture.vehicle.charge_schedules[197400] = {
      ...fixture.agent.convertToTeslaSchedule({ chargeStart: now + onboardStartsInMs, chargeStop: now + 3 * 60 * 60e3 }, location),
      id: 197400,
    };
  }
  return { ...fixture, tick: () => fixture.agent.tryEmergencyWakeForCharging({}, fixture.vehicle, location) };
};

test("emergency wake for needed charge whose allocation passed before the grace, while a top-up follows", async () => {
  // The planner allocates the first 10 minutes of a run to Routine and the rest to Prefered.
  const routineStop = iso(Date.now() - 10 * 60e3);
  const withRoutineHead = (soc) => {
    const fixture = blockedCharge(undefined, "Prefered");
    const [prefered] = fixture.vehicle.dbData.chargePlan;
    fixture.vehicle.dbData.chargePlan = [
      { ...prefered, chargeType: "Routine", chargeStop: routineStop, level: 60 },
      { ...prefered, chargeStart: routineStop },
    ];
    fixture.vehicle.telemetryData.Soc = soc;
    return fixture;
  };
  const below = withRoutineHead(38);
  await below.tick();
  assert.deepEqual(below.wakes, ["TESTVIN0000000001"]);
  // A later run of top-ups still wakes for the needed charge planned before it.
  const later = withRoutineHead(38);
  const [routine, prefered] = later.vehicle.dbData.chargePlan;
  later.vehicle.dbData.chargePlan = [
    { ...routine, chargeStart: iso(Date.now() - 3 * 60 * 60e3), chargeStop: iso(Date.now() - 2 * 60 * 60e3) },
    { ...prefered, chargeStart: iso(Date.now() - 20 * 60e3) },
  ];
  await later.tick();
  assert.deepEqual(later.wakes, ["TESTVIN0000000001"]);
  // The needed level is reached: only the top-up is left.
  const reached = withRoutineHead(62);
  await reached.tick();
  assert.deepEqual(reached.wakes, []);
});

test("emergency wake for needed charge in an open window that is never written to the car", async () => {
  const { vehicle, wakes, tick } = blockedCharge();
  vehicle.dbData.chargePlan = [{ chargeStart: null, chargeStop: null, chargeType: "Manual", level: 80 }];
  await tick();
  assert.deepEqual(wakes, ["TESTVIN0000000001"]);
});

test("no emergency wake and no error for a car without a charge plan", async () => {
  const { vehicle, wakes, tick } = blockedCharge();
  vehicle.dbData.chargePlan = null;
  assert.equal(await tick(), false);
  assert.deepEqual(wakes, []);
});

test("emergency wake answered offline starts the cooldown instead of re-waking every tick", async () => {
  // wake_up answers "offline" while the car boots; without the cooldown each 30s tick woke it again.
  const { wakes, vehicle, tick } = blockedCharge();
  for (let i = 0; i < 3; i++) {
    assert.equal(await tick(), false);
  }
  assert.deepEqual(wakes, ["TESTVIN0000000001"]);
  assert.equal(typeof vehicle.dbData.providerData.emergency_wakeup_at, "number");
});

test("emergency wake that fails before an answer starts no cooldown", async () => {
  const { agent, wakes, vehicle, tick } = blockedCharge();
  const answer = agent.callTeslaAPI;
  agent.callTeslaAPI = async () => {
    throw new Error("token refresh failed");
  };
  await assert.rejects(tick());
  assert.equal(vehicle.dbData.providerData.emergency_wakeup_at, undefined);
  agent.callTeslaAPI = answer;
  await tick();
  assert.deepEqual(wakes, ["TESTVIN0000000001"]);
});

test("emergency wake waits for an onboard schedule starting within 30 minutes or started under 5 minutes ago", async () => {
  // Onboard times have whole minutes, so -3 min stays clear of the 5 min edge whatever second the test starts.
  for (const startsIn of [15 * 60e3, 30 * 60e3, -3 * 60e3]) {
    const { wakes, tick } = blockedCharge(startsIn);
    assert.equal(await tick(), false);
    assert.deepEqual(wakes, [], `onboard start in ${startsIn / 60e3}m`);
  }
  for (const startsIn of [45 * 60e3, -6 * 60e3]) {
    const { wakes, tick } = blockedCharge(startsIn);
    await tick();
    assert.deepEqual(wakes, ["TESTVIN0000000001"], `onboard start in ${startsIn / 60e3}m`);
  }
});

test("emergency wake does not wait for an onboard start after the needed run ends", async () => {
  const { vehicle, wakes, tick } = blockedCharge(15 * 60e3);
  vehicle.dbData.chargePlan[0].chargeStop = iso(Date.now() + 10 * 60e3);
  await tick();
  assert.deepEqual(wakes, ["TESTVIN0000000001"]);
});

test("emergency wake waits for an onboard start inside a plan entry that continues the run after now", async () => {
  const { vehicle, wakes, tick } = blockedCharge(15 * 60e3);
  const [needed] = vehicle.dbData.chargePlan;
  const split = iso(Date.now() + 10 * 60e3);
  vehicle.dbData.chargePlan = [{ ...needed, chargeStop: split }, { ...needed, chargeStart: split, chargeType: "Prefered" }];
  assert.equal(await tick(), false);
  assert.deepEqual(wakes, []);
});

test("a schedule read from Tesla with days_of_week outside the bitmask is dropped", async () => {
  const { agent, vehicle } = stoppedCar([]);
  const schedule = (id, days_of_week) => ({ id, days_of_week, enabled: true, one_time: false, start_enabled: true, start_time: 0, end_enabled: false, latitude: 0, longitude: 0 });
  agent.callTeslaAPI = async () => ({ response: {
    charge_schedule_data: { charge_schedules: [schedule(1, 1 << 7), schedule(2, 0b1111111)] },
    preconditioning_schedule_data: { precondition_schedules: [] },
  } });
  await agent.refreshVehicleSchedules({}, vehicle, "test");
  assert.deepEqual(Object.keys(vehicle.charge_schedules), ["2"]);
});

test("emergency wake does not wait for a disabled onboard schedule or one written at another location", async () => {
  for (const onboard of [{ enabled: false }, { latitude: location.geoLocation.latitude + 0.01 }]) {
    const { wakes, vehicle, tick } = blockedCharge(15 * 60e3);
    Object.assign(vehicle.charge_schedules[197400], onboard);
    await tick();
    assert.deepEqual(wakes, ["TESTVIN0000000001"], JSON.stringify(onboard));
  }
});

test("emergency wake after an expired cooldown starts a new cooldown", async () => {
  const { wakes, vehicle, tick } = blockedCharge();
  vehicle.dbData.providerData.emergency_wakeup_at = Date.now() - 24 * 60 * 60e3;
  await tick();
  await tick();
  assert.deepEqual(wakes, ["TESTVIN0000000001"]);
});

test("emergency wake grace runs from the start of the charging run", async () => {
  const { vehicle, wakes, tick } = blockedCharge();
  vehicle.dbData.chargePlan[0].chargeStart = iso(Date.now() - 5 * 60e3);
  await tick();
  assert.deepEqual(wakes, []);
});

test("emergency wake only for needed charge, not for price-driven top-ups", async () => {
  // Prefered and Fill windows are price-driven top-ups, e.g. a small "charge setting" top-up.
  for (const chargeType of ["Prefered", "Fill"]) {
    const { wakes, tick } = blockedCharge(undefined, chargeType);
    await tick();
    assert.deepEqual(wakes, [], chargeType);
  }
  for (const chargeType of ["Minimum", "Manual", "Trip", "Routine"]) {
    const { wakes, tick } = blockedCharge(undefined, chargeType);
    await tick();
    assert.deepEqual(wakes, ["TESTVIN0000000001"], chargeType);
  }
});

test("schedule rewrites that cannot change what the car does are moot", () => {
  const now = ts("2026-04-22T00:10:00Z");
  // Completed charge blocker: its end creeps with now every 15 minutes.
  assert.equal(teslaScheduleRewriteIsMoot(
    { chargeStart: null, chargeStop: ts("2026-04-21T23:45:00Z") },
    { chargeStart: null, chargeStop: ts("2026-04-22T00:00:00Z") },
    now, false), true);
  // Charging after a completed blocker: the rewrite is what stops it.
  assert.equal(teslaScheduleRewriteIsMoot(
    { chargeStart: null, chargeStop: ts("2026-04-21T23:45:00Z") },
    { chargeStart: null, chargeStop: ts("2026-04-22T00:00:00Z") },
    now, true), false);
  // A completed start+end window is no blocker: the car disables a one-time window once it has run.
  assert.equal(teslaScheduleRewriteIsMoot(
    { chargeStart: ts("2026-04-21T22:00:00Z"), chargeStop: ts("2026-04-21T23:45:00Z") },
    { chargeStart: null, chargeStop: ts("2026-04-22T00:00:00Z") },
    now, false), false);
  // Charging inside the window; only the passed start moved.
  const running = { chargeStart: ts("2026-04-21T23:45:00Z"), chargeStop: ts("2026-04-22T03:15:00Z") };
  const moved = { chargeStart: ts("2026-04-22T00:00:00Z"), chargeStop: ts("2026-04-22T03:15:00Z") };
  assert.equal(teslaScheduleRewriteIsMoot(running, moved, now, true), true);
  // Stopped inside the window: the back-dated rewrite is what kicks charging off, keep it.
  assert.equal(teslaScheduleRewriteIsMoot(running, moved, now, false), false);
  // The end of the running window moved while charging: waits until 15 min before the earlier end.
  const later = { ...moved, chargeStop: ts("2026-04-22T03:30:00Z") };
  assert.equal(teslaScheduleRewriteIsMoot(running, later, now, true), true);
  assert.equal(teslaScheduleRewriteIsMoot(running, later, ts("2026-04-22T02:59:00Z"), true), true);
  assert.equal(teslaScheduleRewriteIsMoot(running, later, ts("2026-04-22T03:00:00Z"), true), false);
  const earlier = { ...moved, chargeStop: ts("2026-04-22T01:00:00Z") };
  assert.equal(teslaScheduleRewriteIsMoot(running, earlier, ts("2026-04-22T00:44:00Z"), true), true);
  assert.equal(teslaScheduleRewriteIsMoot(running, earlier, ts("2026-04-22T00:45:00Z"), true), false);
  // Not charging: the car may sleep before the end, so the end is written now.
  assert.equal(teslaScheduleRewriteIsMoot(running, later, now, false), false);
  // A future start moved: changes when charging starts.
  assert.equal(teslaScheduleRewriteIsMoot(
    { chargeStart: ts("2026-04-22T01:00:00Z"), chargeStop: ts("2026-04-22T03:15:00Z") },
    { chargeStart: ts("2026-04-22T01:15:00Z"), chargeStop: ts("2026-04-22T03:15:00Z") },
    now, true), false);
});

// handleSchedules for a plugged-in, Stopped car at the location
const runHandleSchedules = async (chargePlan, vehicleOverrides) => {
  const fixture = stoppedCar(chargePlan, vehicleOverrides);
  await fixture.agent.handleSchedules({}, fixture.vehicle, { ...location, id: "home" }, 0, false);
  return fixture;
};

test("a plan entry shorter than the schedule quantum does not cut the written window short", async () => {
  const start = TeslaAgent.prototype.quantizeTime(Date.now(), Math.ceil) + 60 * 60e3;
  const { agent, calls } = await runHandleSchedules([
    { chargeType: "Routine", chargeStart: iso(start + 5 * 60e3), chargeStop: iso(start + 10 * 60e3), level: 60 },
    { chargeType: "Prefered", chargeStart: iso(start + 10 * 60e3), chargeStop: iso(start + 60 * 60e3), level: 80 },
  ]);
  const expected = agent.convertToTeslaSchedule({ chargeStart: start, chargeStop: start + 60 * 60e3 }, location);
  assert.deepEqual(
    calls.filter((c) => c.fn === teslaAPI.addChargeSchedule).map((c) => [c.arg.start_time, c.arg.end_time]),
    [[expected.start_time, expected.end_time]]
  );
});

test("a window inside an open-ended top-up merges into it", async () => {
  const start = TeslaAgent.prototype.quantizeTime(Date.now(), Math.ceil) + 60 * 60e3;
  const { calls } = await runHandleSchedules([
    { chargeType: "Trip", chargeStart: iso(start), chargeStop: null, level: 90 },
    { chargeType: "Routine", chargeStart: iso(start + 60 * 60e3), chargeStop: iso(start + 2 * 60 * 60e3), level: 60 },
  ]);
  assert.deepEqual(
    calls.filter((c) => c.fn === teslaAPI.addChargeSchedule).map((c) => [c.arg.start_enabled, c.arg.end_enabled]),
    [[true, false]]
  );
});

test("a completed blocker whose end crept is rewritten only when the car disabled it", async () => {
  // Unplugged with no plan: handleSchedules requests a completed end-only blocker at now - 10 min.
  const stop = TeslaAgent.prototype.quantizeTime(Date.now() - 10 * 60e3, Math.floor) - 15 * 60e3;
  for (const enabled of [true, false]) {
    const blocker = { ...TeslaAgent.prototype.convertToTeslaSchedule({ chargeStart: null, chargeStop: stop }, location), id: 197400, enabled };
    const { calls } = await runHandleSchedules([], {
      charge_schedules: { 197400: blocker },
      dbData: { isConnected: false, providerData: {}, schedule: [], chargePlan: [] },
      telemetryData: { Soc: 38, ChargeLimitSoc: 80, DetailedChargeState: telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected },
    });
    assert.deepEqual(calls.map((c) => c.fn), enabled ? [] : [teslaAPI.addChargeSchedule], `enabled ${enabled}`);
  }
});

test("an asleep car is sent no delete for a schedule written at another location", async () => {
  const elsewhere = { id: 197400, one_time: true, enabled: true, latitude: location.geoLocation.latitude + 0.1, longitude: location.geoLocation.longitude, start_enabled: false, end_enabled: true, end_time: 0, days_of_week: 1 };
  const { calls } = await runHandleSchedules([], { isOnline: false, charge_schedules: { 197400: elsewhere } });
  assert.deepEqual(calls, []);
});

test("an asleep Stopped car gets the emergency wake grace from the planned window start", async () => {
  // The plan began this quarter hour; handleSchedules back-dates the Stopped car's window by at least 10 min.
  const start = TeslaAgent.prototype.quantizeTime(Date.now(), Math.floor);
  const { calls } = await runHandleSchedules(
    [{ chargeType: "Routine", chargeStart: iso(start), chargeStop: iso(start + 3 * 60 * 60e3), level: 80 }],
    { isOnline: false, charge_schedules: undefined },
  );
  assert.deepEqual(calls, []);
});

test("an asleep Stopped car is emergency-woken for a needed window that began before the back-dated start", async () => {
  // handleSchedules writes the start as now - 10 min (quantized), later than the planned start 30 min ago.
  const start = Date.now() - 30 * 60e3;
  const { calls } = await runHandleSchedules(
    [{ chargeType: "Routine", chargeStart: iso(start), chargeStop: iso(start + 3 * 60 * 60e3), level: 80 }],
    { isOnline: false, charge_schedules: undefined },
  );
  assert.deepEqual(calls.map((c) => c.fn), [teslaAPI.wakeUp]);
});

test("a charging or unplugged asleep car is not emergency-woken", async () => {
  const start = Date.now() - 30 * 60e3;
  const plan = [{ chargeType: "Routine", chargeStart: iso(start), chargeStop: iso(start + 3 * 60 * 60e3), level: 80 }];
  const { DetailedChargeStateCharging, DetailedChargeStateDisconnected } = telemetryData.DetailedChargeStateValue;
  for (const [isConnected, DetailedChargeState] of [[true, DetailedChargeStateCharging], [false, DetailedChargeStateDisconnected]]) {
    const { calls } = await runHandleSchedules(plan, {
      isOnline: false,
      charge_schedules: undefined,
      dbData: { isConnected, providerData: {}, schedule: [], chargePlan: plan },
      telemetryData: { Soc: 38, ChargeLimitSoc: 80, DetailedChargeState },
    });
    assert.deepEqual(calls, [], String(DetailedChargeState));
  }
});

test("onboard schedule times resolve to the occurrence nearest to local now", () => {
  // Local time in UTC fields; 2026-10-16 is a Friday.
  const at = (dow, time, now) => TeslaScheduleTimeToDate(dow, time, new Date(now)).toISOString();
  const FRI = 1 << 5;
  const DAILY = 0b1111111;
  assert.equal(at(FRI, 21 * 60, "2026-10-16T20:00:00Z"), "2026-10-16T21:00:00.000Z");
  // A one-time schedule that ended yesterday is still yesterday's, not next week's.
  assert.equal(at(FRI, 23 * 60 + 40, "2026-10-17T03:00:00Z"), "2026-10-16T23:40:00.000Z");
  // A daily schedule just after midnight starts tomorrow, not earlier today.
  assert.equal(at(DAILY, 5, "2026-10-16T23:50:00Z"), "2026-10-17T00:05:00.000Z");
  assert.equal(at(DAILY, 80, "2026-10-17T01:00:00Z"), "2026-10-17T01:20:00.000Z");
});

for (const error of [
  new RestClientError("Request timeout", 408),
  new RestClientError("vehicle unavailable: vehicle is offline or asleep", 500),
  new RestClientError("Too Many Requests", 429),
]) {
  test(`a failed command (${error.code}) pauses commands without marking a streaming car offline`, async () => {
    const agent = Object.create(TeslaAgent.prototype);
    let calls = 0;
    agent.scheduleAuditIntervalMs = () => null;
    agent.getLocation = async () => location;
    agent.handleSchedules = async () => {
      calls++;
      throw error;
    };
    const vehicle = {
      vin: "TESTVIN0000000001",
      isOnline: true,
      tsUpdate: Date.now(),
      network: { stream: "connected" },
      charge_schedules: {},
      precondition_schedules: {},
      dbData: { locationID: "00000000-0000-0000-0000-000000000002" },
      telemetryData: {},
    };
    await agent.vehicleWork({}, vehicle);
    assert.equal(vehicle.isOnline, true);
    assert.deepEqual(vehicle.network, { stream: "connected" });
    await agent.vehicleWork({}, vehicle);
    assert.equal(calls, 1);
    // A plug-in still gets its immediate check, and the pause ends on its own.
    vehicle.lastPlugInAt = Date.now();
    await agent.vehicleWork({}, vehicle);
    assert.equal(calls, 2);
    // That plug-in's bypass is spent even though its command failed.
    await agent.vehicleWork({}, vehicle);
    assert.equal(calls, 2);
    vehicle.commandBackoffUntil = Date.now() - 1;
    await agent.vehicleWork({}, vehicle);
    assert.equal(calls, 3);
  });
}

test("a telemetry connect lifts the command pause", async () => {
  const agent = Object.create(TeslaAgent.prototype);
  const vehicle = { vin: "TESTVIN0000000001", network: {}, commandBackoffUntil: Date.now() + 5 * 60e3 };
  agent.vehicleEntry = () => vehicle;
  await agent.telemetryConnectivityMessage({
    vin: vehicle.vin,
    connectionId: "c1",
    networkInterface: "wifi",
    status: telemetryConnectivity.ConnectivityEvent.CONNECTED,
  });
  assert.equal(vehicle.commandBackoffUntil, undefined);
});
