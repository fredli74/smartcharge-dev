import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./scenario.mjs";

// One server and one database for the whole run, so the specs run in order in a single worker.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  globalSetup: "./global-setup.mjs",
  workers: 1,
  reporter: "list",
  outputDir: "../test-results/bench",
  snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{testFileName}/{arg}{ext}",
  expect: {
    // Runs are pixel-identical, so the tolerance is tight. A pixel-count allowance would pass a changed status
    // line (a few hundred pixels), and the default per-pixel threshold (0.2) passes a recoloured 20%-opacity
    // plan window. 0.05 still absorbs faint shade noise.
    toHaveScreenshot: { threshold: 0.05, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: BASE_URL,
    timezoneId: "Europe/Stockholm",
    locale: "sv-SE",
    colorScheme: "light",
    serviceWorkers: "block",
  },
  // The GraphQL contract does not depend on a screen, the UI specs run at both sizes
  projects: [
    { name: "api", testMatch: "gql.spec.mjs" },
    // A phone: the app is mostly used as an installed PWA
    { name: "phone", testIgnore: "gql.spec.mjs", use: { viewport: { width: 412, height: 915 } } },
    { name: "desktop", testIgnore: "gql.spec.mjs", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
