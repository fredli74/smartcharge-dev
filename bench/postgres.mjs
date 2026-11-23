// Throwaway Postgres cluster for one bench run. Its whole clock (now(), current_date, ...) is frozen by
// libfaketime at the instant written in the clock file, which is re-read on every time call.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Production runs Postgres 15 (deploy/postgres.Dockerfile).
const PG_BIN = "/usr/lib/postgresql/15/bin";
const FAKETIME_LIB = "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1";
const PORT = 54329;

export function writeClockFile(file, ms) {
  writeFileSync(file, new Date(ms).toISOString().replace("T", " ").slice(0, 19)); // absolute = frozen
}

export function startPostgres(clockFile) {
  const dir = mkdtempSync(path.join(tmpdir(), "smartcharge-bench-"));
  const data = path.join(dir, "data");
  const run = (bin, args, env = process.env) =>
    execFileSync(path.join(PG_BIN, bin), args, { env, stdio: ["ignore", "ignore", "inherit"] });

  run("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-sync"]);
  run("pg_ctl", ["-D", data, "-l", path.join(dir, "postgres.log"), "-w", "-o",
    `-p ${PORT} -k ${dir} -c listen_addresses=localhost -c fsync=off -c TimeZone=UTC`, "start"], {
    ...process.env,
    TZ: "UTC",
    LD_PRELOAD: FAKETIME_LIB,
    FAKETIME_TIMESTAMP_FILE: clockFile,
    FAKETIME_NO_CACHE: "1",
    FAKETIME_DONT_FAKE_MONOTONIC: "1",
  });
  // Each -c runs on its own, so CREATE DATABASE stays outside a transaction
  run("psql", ["-h", dir, "-p", `${PORT}`, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q",
    "-c", "CREATE ROLE scserver LOGIN PASSWORD 'scserver';", "-c", "CREATE DATABASE smartcharge OWNER scserver;"]);
  return {
    url: `postgres://scserver:scserver@localhost:${PORT}/smartcharge`,
    stop() {
      run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
