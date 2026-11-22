// Starts the bench: a throwaway Postgres, the seed replay, then the built server on the frozen anchor.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPostgres, writeClockFile } from "./postgres.mjs";
import * as S from "./scenario.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  // The server logs a busy port and keeps running, so readiness would poll whatever else owns it
  await new Promise((resolve, reject) => {
    const probe = net.createServer().once("error", reject).listen(S.SERVER_PORT, () => probe.close(resolve));
  });
  // The node children run outside the repo so the server's dotenv never reads the repo's .env
  const dir = mkdtempSync(path.join(tmpdir(), "smartcharge-bench-run-"));
  const clock = path.join(dir, "clock");
  writeClockFile(clock, S.REPLAY_FROM);
  const pg = startPostgres(clock);
  const env = { ...process.env, TZ: "UTC", POSTGRES_URL: pg.url, BENCH_CLOCK_FILE: clock, PUBLIC_URL: "" };
  const node = (script) => ["--import", path.join(HERE, "clock.mjs"), script];

  execFileSync(process.execPath, node(path.join(HERE, "seed.mjs")), { cwd: dir, env, stdio: ["ignore", "ignore", "inherit"] });

  const logFile = path.join(dir, "server.log");
  const log = openSync(logFile, "a");
  const server = spawn(process.execPath, node(path.join(HERE, "../dist/server/server.js")), {
    cwd: dir,
    env: { ...env, SINGLE_USER: "true", SERVER_PORT: `${S.SERVER_PORT}` },
    stdio: ["ignore", log, log],
  });
  const teardown = async () => {
    server.kill();
    pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
  for (;;) {
    if (server.exitCode !== null) {
      process.stderr.write(readFileSync(logFile));
      await teardown();
      throw new Error(`bench server exited with ${server.exitCode}, its log is above`);
    }
    if (await fetch(`${S.BASE_URL}/api/config`).then((r) => r.ok, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return teardown;
}
