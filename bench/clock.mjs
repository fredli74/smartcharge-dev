// Node preload (--import) that freezes Date at the instant in BENCH_CLOCK_FILE, the same file libfaketime
// freezes Postgres with. globalThis.benchSetNow moves both clocks together (the seed replay uses it).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { writeClockFile } from "./postgres.mjs";

const RealDate = Date;
const file = process.env.BENCH_CLOCK_FILE;
let now = RealDate.parse(`${readFileSync(file, "utf8").replace(" ", "T")}Z`);
assert(Number.isFinite(now), `${file} must hold "YYYY-MM-DD hh:mm:ss" UTC`);

globalThis.Date = class BenchDate extends RealDate {
  constructor(...args) {
    super(...(args.length > 0 ? args : [now]));
  }
  static now() {
    return now;
  }
};
globalThis.benchSetNow = (ms) => {
  now = ms;
  writeClockFile(file, ms);
};
