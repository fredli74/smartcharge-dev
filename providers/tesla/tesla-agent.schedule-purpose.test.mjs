import test from "node:test";
import assert from "node:assert/strict";

import {
  TeslaAgent,
  teslaSchedulePurposeCadenceMs,
  teslaScheduleServesRequestedPurpose,
  teslaShouldMaintainRemoteHomeSchedule,
  teslaWantedSocLimit,
} from "../../dist/providers/tesla/tesla-agent.js";
import * as telemetryData from "../../dist/providers/tesla/telemetry-protos/vehicle_data_pb.js";

const location = {
  geoFenceRadius: 250,
  geoLocation: {
    latitude: 59.0,
    longitude: 18.0,
  },
};

const ts = (iso) => new Date(iso).getTime();

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
      10_000,
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
    teslaShouldMaintainRemoteHomeSchedule(false, location, 49_000, TeslaAgent.APPROACH_CHARGE_LOCATION_M),
    true
  );
  assert.equal(
    teslaShouldMaintainRemoteHomeSchedule(false, location, 51_000, TeslaAgent.APPROACH_CHARGE_LOCATION_M),
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
    teslaSchedulePurposeCadenceMs(false, location, 10_000, TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS, TeslaAgent.FLUID_SCHEDULE_CADENCE_MS),
    TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
  );
});

test("missing wanted SOC means no charge-limit target", () => {
  assert.equal(teslaWantedSocLimit(undefined), null);
});
