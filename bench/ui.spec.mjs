// Visual regression: the built app against the seeded server, with the browser frozen at the anchor.
import { test, expect } from "@playwright/test";
import * as S from "./scenario.mjs";

// Everything but the bench server and the app's web fonts is blocked, so no outside service shows up.
const ALLOWED_HOSTS = ["localhost", "fonts.googleapis.com", "fonts.gstatic.com"];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(S.ANCHOR);
  await page.route("**/*", (route) =>
    ALLOWED_HOSTS.includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

async function signIn(page) {
  await page.addInitScript((token) => localStorage.setItem("token", token), S.TOKEN);
}

test("login", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveScreenshot("login.png");
});

test("vehicle list", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByText(S.BETA.name)).toBeVisible();
  await expect(page).toHaveScreenshot("home.png", { fullPage: true });
});

for (const vehicle of [S.ALPHA, S.BETA]) {
  test(`vehicle ${vehicle.name}`, async ({ page }) => {
    await signIn(page);
    await page.goto(`/vehicle/${vehicle.id}`);
    // The chart loads after the page settles, so a blank chart area would otherwise pass as stable
    await expect(page.locator("#timechart svg")).toBeVisible();
    await expect(page.locator("#eventchart svg")).toBeVisible();
    await expect(page).toHaveScreenshot(`vehicle-${vehicle.name.split(" ")[1].toLowerCase()}.png`, { fullPage: true });
  });
}

test("settings", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page).toHaveScreenshot("settings.png", { fullPage: true });
});
