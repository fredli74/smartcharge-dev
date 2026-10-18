import test from "node:test";
import assert from "node:assert/strict";

import { TeslaAgent } from "../../dist/providers/tesla/tesla-agent.js";

const agent = Object.create(TeslaAgent.prototype);
const location = { geoLocation: { latitude: 59.0, longitude: 18.0 } };
// Local time at the location, in UTC fields
const toUTC = (local) => agent.ConvertLocationTimeToUTC(location, new Date(local)).toISOString();
const toLocal = (utc) => agent.ConvertUTCtoLocationTime(location, new Date(utc)).toISOString();

test("location time converts to UTC with the offset of the resulting instant", () => {
  assert.equal(toUTC("2026-07-01T12:00:00Z"), "2026-07-01T10:00:00.000Z");
  assert.equal(toUTC("2026-12-01T12:00:00Z"), "2026-12-01T11:00:00.000Z");
  // Autumn change 2026-10-25 01:00Z: 01:00 local is still summer time.
  assert.equal(toUTC("2026-10-25T01:00:00Z"), "2026-10-24T23:00:00.000Z");
  assert.equal(toUTC("2026-10-25T03:30:00Z"), "2026-10-25T02:30:00.000Z");
  // Spring change 2027-03-28 01:00Z: 01:30 local is still winter time.
  assert.equal(toUTC("2027-03-28T01:30:00Z"), "2027-03-28T00:30:00.000Z");
  assert.equal(toUTC("2027-03-28T04:00:00Z"), "2027-03-28T02:00:00.000Z");
});

test("UTC round-trips through location time across both DST nights", () => {
  for (const [from, repeatedFrom, repeatedTo] of [
    ["2026-10-24T20:00:00Z", "2026-10-25T00:00:00Z", "2026-10-25T01:00:00Z"],
    ["2027-03-27T20:00:00Z", null, null],
  ]) {
    for (let t = Date.parse(from); t < Date.parse(from) + 8 * 60 * 60e3; t += 15 * 60e3) {
      // The first pass of the repeated autumn hour reads back as its second pass.
      if (repeatedFrom && t >= Date.parse(repeatedFrom) && t < Date.parse(repeatedTo)) continue;
      const utc = new Date(t).toISOString();
      assert.equal(toUTC(toLocal(utc)), utc, utc);
    }
  }
});
