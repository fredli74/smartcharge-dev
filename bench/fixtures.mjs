// Shared browser setup for the bench's UI specs: frozen clock, closed network, sign-in and slider drags.
import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import * as S from "./scenario.mjs";

// Everything but the bench server and the app's web fonts is blocked, so no outside service shows up.
// Tesla's car renders are answered with our own placeholder: their images are not ours to copy.
const ALLOWED_HOSTS = ["localhost", "fonts.googleapis.com", "fonts.gstatic.com"];
const VEHICLE_PLACEHOLDER = readFileSync(new URL("./vehicle-placeholder.svg", import.meta.url));

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(S.ANCHOR);
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "static-assets.tesla.com") {
        return route.fulfill({ contentType: "image/svg+xml", body: VEHICLE_PLACEHOLDER });
      }
      return ALLOWED_HOSTS.includes(url.hostname) ? route.continue() : route.abort();
    });
    await use(page);
  },
});
export { expect };

export async function signIn(page) {
  await page.addInitScript((token) => localStorage.setItem("token", token), S.TOKEN);
}

// Opens a vehicle page once its chart is drawn; a blank chart area would otherwise pass as a stable page.
export async function openVehicle(page, vehicle) {
  await signIn(page);
  await page.goto(`/vehicle/${vehicle.id}`);
  await expect(page.locator("#timechart svg")).toBeVisible();
  await expect(page.locator("#eventchart svg")).toBeVisible();
}

// Drags the slider inside `scope` from its thumb to the position of `level`, like a finger would. A level
// outside the slider's range drags past the end of the track.
export async function dragSlider(page, scope, level) {
  const slider = scope.locator("[role=slider]");
  await expect(scope.locator(".v-slider__thumb")).toBeVisible(); // menus animate open
  const min = Number(await slider.getAttribute("aria-valuemin"));
  const max = Number(await slider.getAttribute("aria-valuemax"));
  const track = await scope.locator(".v-slider__track-container").boundingBox();
  const thumb = await scope.locator(".v-slider__thumb").boundingBox();
  const y = thumb.y + thumb.height / 2;
  await page.mouse.move(thumb.x + thumb.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + (track.width * (level - min)) / (max - min), y, { steps: 10 });
  await page.mouse.up();
}

// Waits until every visible v-img has loaded; an image area still loading is just as stable as a loaded one.
// (The vehicle page hides its picture on a phone, so the count is taken from what is visible.)
export async function imagesLoaded(page) {
  await expect(page.locator(".v-image:visible .v-image__image"))
    .toHaveCount(await page.locator(".v-image:visible").count());
}
