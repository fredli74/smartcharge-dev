import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWindowAllocations,
  planChargeWindows,
} from "../dist/server/charge-window-planner.js";
import { ChargeType } from "../dist/shared/sc-types.js";
import { LogLevel, setLogLevel } from "../dist/shared/utils.js";

setLogLevel(LogLevel.Error);

const M = 60e3;
const H = 60 * M;
// Prices use the DB integer scale (price * 1e5).
const slot = (from, to, price) => ({ from, to, price: price * 1e5 });
const ctx = (priceSlots, { disallowGaps = false, warmupPenaltyMs = 0 } = {}) => ({
  vehicleUUID: "test-vehicle",
  priceSlots,
  disallowGaps,
  warmupPenaltyMs,
});
const plan = (c, args) => planChargeWindows(c, {
  hardStart: 0,
  hardEnd: Number.POSITIVE_INFINITY,
  maxPrice: undefined,
  scheduleTag: "test",
  isCharging: false,
  ...args,
});
const spans = (entries) => entries.map((e) => [e.chargeStart.getTime(), e.chargeStop.getTime()]);

test("window time after allocations run out stays inside its own window", () => {
  const windows = [
    { start: 0, stop: 30 * M },
    { start: 60 * M, stop: 90 * M },
    { start: 120 * M, stop: 135 * M },
  ];
  const { entries, lastStop } = applyWindowAllocations(
    windows,
    [{ durationMs: 60 * M, chargeType: ChargeType.Fill, comment: "low price", level: 80 }],
    0
  );
  assert.deepEqual(spans(entries), windows.map((w) => [w.start, w.stop]));
  assert.equal(lastStop, 135 * M);
});

test("allocations ending inside the final window keep the full tariff interval", () => {
  const { entries } = applyWindowAllocations(
    [{ start: 0, stop: 60 * M }],
    [{ durationMs: 45 * M, chargeType: ChargeType.Routine, comment: "routine charge", level: 60 }],
    0
  );
  assert.deepEqual(spans(entries), [[0, 60 * M]]);
});

test("allocation labels split windows at delivered-time boundaries", () => {
  const { entries } = applyWindowAllocations(
    [{ start: 0, stop: 2 * H }],
    [
      { durationMs: H, chargeType: ChargeType.Trip, comment: "upcoming trip", level: 70 },
      { durationMs: 30 * M, chargeType: ChargeType.Fill, comment: "low price", level: 90 },
    ],
    0
  );
  assert.deepEqual(
    entries.map((e) => [e.chargeType, e.chargeStart.getTime(), e.chargeStop.getTime()]),
    [[ChargeType.Trip, 0, H], [ChargeType.Fill, H, 2 * H]]
  );
});

test("zero warmup penalty splits into the cheapest intervals", async () => {
  const slots = [slot(0, H, 10), slot(H, 2 * H, 50), slot(2 * H, 3 * H, 10)];
  const r = await plan(ctx(slots), { timeNeededMs: 2 * H, beforeTimestampMs: 3 * H });
  assert.deepEqual(r.windows, [{ start: 0, stop: H }, { start: 2 * H, stop: 3 * H }]);
  assert.equal(r.deliveredMs, 2 * H);
  assert.equal(r.scheduledMs, 2 * H);
});

test("warmup penalty makes one contiguous window beat splitting", async () => {
  const slots = [slot(0, H, 10), slot(H, 2 * H, 50), slot(2 * H, 3 * H, 10)];
  const r = await plan(ctx(slots, { warmupPenaltyMs: H }), { timeNeededMs: 2 * H, beforeTimestampMs: 3 * H });
  assert.deepEqual(r.windows, [{ start: 0, stop: 2 * H }]);
  assert.equal(r.deliveredMs, 2 * H);
});

test("never mode schedules at most one contiguous window", async () => {
  const slots = [slot(0, H, 10), slot(H, 2 * H, 50), slot(2 * H, 3 * H, 10)];
  const r = await plan(ctx(slots, { disallowGaps: true }), { timeNeededMs: 2 * H, beforeTimestampMs: 3 * H });
  assert.deepEqual(r.windows, [{ start: 0, stop: 2 * H }]);
});

test("never mode with active charge and no immediate interval yields no plan", async () => {
  const slots = [slot(H, 2 * H, 10)];
  const r = await plan(ctx(slots, { disallowGaps: true }), { timeNeededMs: H, beforeTimestampMs: 2 * H, isCharging: true });
  assert.deepEqual(r.windows, []);
  assert.equal(r.deliveredMs, 0);
});

test("maxPrice yields best-effort shorter plan instead of over-average plan", async () => {
  const slots = [slot(0, H, 10), slot(H, 2 * H, 20)];
  const r = await plan(ctx(slots), { timeNeededMs: 2 * H, beforeTimestampMs: 2 * H, maxPrice: 14e5 });
  assert.deepEqual(r.windows, [{ start: 0, stop: H }]);
  assert.equal(r.deliveredMs, H);
});

test("slots above the soft maxPrice cap are dropped entirely", async () => {
  const slots = [slot(0, H, 10), slot(H, 2 * H, 22)];
  const r = await plan(ctx(slots), { timeNeededMs: 2 * H, beforeTimestampMs: 2 * H, maxPrice: 14e5 });
  assert.deepEqual(r.windows, [{ start: 0, stop: H }]);
});

test("deliveredMs excludes warmup debt while scheduledMs includes it", async () => {
  const slots = [slot(0, H, 10), slot(2 * H, 3 * H, 10)];
  const r = await plan(ctx(slots, { warmupPenaltyMs: 30 * M }), { timeNeededMs: 2 * H, beforeTimestampMs: 3 * H });
  assert.deepEqual(r.windows, [{ start: 0, stop: H }, { start: 2 * H, stop: 3 * H }]);
  assert.equal(r.scheduledMs, 2 * H);
  assert.equal(r.deliveredMs, 1.5 * H);
});
