import test from "node:test";
import assert from "node:assert/strict";

import { chargeDuration } from "../dist/server/logic.js";

// 60 s per percent at every level, so durations are easy to read.
const flat = Object.fromEntries(Array.from({ length: 101 }, (_, level) => [level, 60]));

test("the final percent counts as 0.75 of a band", () => {
  // 5 bands: four whole + one trimmed = 4.75 * 60s
  assert.equal(chargeDuration(flat, 20, 25), 4.75 * 60e3);
});

test("a single percent is all trim", () => {
  assert.equal(chargeDuration(flat, 79, 80), 0.75 * 60e3);
});

test("no charge needed when the target is at or below the start", () => {
  assert.equal(chargeDuration(flat, 80, 80), 0);
  assert.equal(chargeDuration(flat, 80, 50), 0);
});

test("levels outside 0-100 clamp onto the curve", () => {
  const curve = { ...flat, 0: 90, 100: 30 };
  assert.equal(chargeDuration(curve, -2, 0), 0.75 * 90e3 + 90e3);
  assert.equal(chargeDuration(curve, 99, 101), 60e3 + 0.75 * 30e3);
});

test("each band is priced by the level it starts at", () => {
  const curve = { ...flat, 50: 100, 51: 10, 52: 20, 53: 40 };
  // bands 50->51 (curve[50]=100s), 51->52 (curve[51]=10s), 52->53 trimmed (curve[52]=20 * 0.75)
  assert.equal(chargeDuration(curve, 50, 53), (100 + 10 + 15) * 1e3);
});
