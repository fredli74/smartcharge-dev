// Shared browser setup for the bench's UI specs: frozen clock, closed network, sign-in and slider drags.
import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import * as S from "./scenario.mjs";

// Everything but the bench server and the app's web fonts is blocked, so no outside service shows up.
// Tesla's car renders are answered with a bench-only placeholder: their images are not ours to copy.
const ALLOWED_HOSTS = ["localhost", "fonts.googleapis.com", "fonts.gstatic.com"];
const VEHICLE_PLACEHOLDER = readFileSync(new URL("./bench-only-car.svg", import.meta.url));

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

// The schedule dialog with a new, unsaved trip; its level starts at the vehicle's maximum (80%)
export async function newTrip(page) {
  await openVehicle(page, S.ALPHA);
  await page.locator("button:has(i.mdi-calendar-clock)").click();
  await page.getByRole("button", { name: "add trip" }).click();
  return page.locator(".new-schedule");
}

// The open menu (level slider or date-time picker), and the picker's days and time items by their text
export const openMenu = (page) => page.locator(".menuable__content__active");
export const pickerDay = (page, day) => openMenu(page)
  .locator(".vdatetime-calendar__month__day", { hasText: new RegExp(`^${day}$`) });
export const pickerTime = (page, list, text) => openMenu(page)
  .locator(`.vdatetime-time-picker__list--${list} .vdatetime-time-picker__item`, { hasText: new RegExp(`^${text}$`) });

// Drags the slider inside `scope` from its thumb to the position of `level`, like a finger would. A level
// outside the slider's range drags past the end of the track.
export async function dragSlider(page, scope, level) {
  const slider = scope.locator("[role=slider]");
  // The press must land on the thumb's centre: the slider offsets the value by any miss. A trial hover waits
  // until the thumb has stopped moving (it slides after a drag, and menus animate open) without the scroll a
  // real hover does, which would shift the dialog under an open menu.
  const thumb = scope.locator(".v-slider__thumb");
  await thumb.hover({ trial: true });
  const min = Number(await slider.getAttribute("aria-valuemin"));
  const max = Number(await slider.getAttribute("aria-valuemax"));
  const track = await scope.locator(".v-slider__track-container").boundingBox();
  const { x, y, width, height } = await thumb.boundingBox();
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + (track.width * (level - min)) / (max - min), y + height / 2, { steps: 10 });
  await page.mouse.up();
}

// Waits until every visible v-img has loaded; an image area still loading is just as stable as a loaded one.
// (The vehicle page hides its picture on a phone, so the count is taken from what is visible.)
export async function imagesLoaded(page) {
  await expect(page.locator(".v-image:visible .v-image__image"))
    .toHaveCount(await page.locator(".v-image:visible").count());
}
