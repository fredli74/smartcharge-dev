// Interaction: a trip schedule is added, edited and removed through the UI the way a user does it (buttons,
// slider drags, the date-time picker). Each step is checked in the backend with the app's own client, and the
// test ends with the vehicle exactly as seeded, so the screenshot spec that runs after it is unaffected.
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { signedInClient } from "./client.mjs";
import * as S from "./scenario.mjs";

const SEEDED_ALPHA = readFileSync(new URL("./snapshots/gql.spec.mjs/vehicle-alpha.json", import.meta.url), "utf8");

// Drags the slider in the open menu from its thumb to the position of `level`, like a finger would.
async function dragSlider(page, level) {
  const menu = page.locator(".menuable__content__active");
  const slider = menu.locator("[role=slider]");
  await expect(menu.locator(".v-slider__thumb")).toBeVisible(); // the menu animates open
  const min = Number(await slider.getAttribute("aria-valuemin"));
  const max = Number(await slider.getAttribute("aria-valuemax"));
  const track = await menu.locator(".v-slider__track-container").boundingBox();
  const thumb = await menu.locator(".v-slider__thumb").boundingBox();
  const y = thumb.y + thumb.height / 2;
  await page.mouse.move(thumb.x + thumb.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + (track.width * (level - min)) / (max - min), y, { steps: 10 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", `${level}`);
  await menu.getByRole("button", { name: "Ok" }).click();
}

test("trip schedule: add, edit and remove", async ({ page }) => {
  const client = await signedInClient();
  // The seeded vehicle also carries the planner's own AI entry; only trips are the user's
  const trips = async () => (await client.getVehicle(S.ALPHA.id)).schedule
    .filter((s) => s.type === "Trip").map(({ type, level, time }) => ({ type, level, time }));

  await page.clock.setFixedTime(S.ANCHOR);
  await page.addInitScript((token) => localStorage.setItem("token", token), S.TOKEN);
  await page.goto(`/vehicle/${S.ALPHA.id}`);
  await expect(page.locator("#timechart svg")).toBeVisible();
  await page.locator("button:has(i.mdi-calendar-clock)").click();

  await test.step("add a trip on Friday 07:30 at 90%", async () => {
    await page.getByRole("button", { name: "add trip" }).click();
    const item = page.locator(".new-schedule");
    await item.locator("button:has(i.mdi-lightning-bolt)").click();
    await dragSlider(page, 90);
    await item.locator("button:has(i.mdi-clock-start)").click();
    const picker = page.locator(".menuable__content__active .vdatetime-popup");
    await picker.locator(".vdatetime-calendar__month__day", { hasText: /^16$/ }).click();
    await picker.locator(".vdatetime-time-picker__list--hours .vdatetime-time-picker__item", { hasText: /^07$/ }).click();
    await picker.locator(".vdatetime-time-picker__list--minutes .vdatetime-time-picker__item", { hasText: /^30$/ }).click();
    await expect(item.locator("button:has(i.mdi-clock-start)")).toContainText("07:30");
    await item.getByRole("button", { name: "Add" }).click();
    await expect.poll(trips).toEqual([{ type: "Trip", level: 90, time: "2026-01-16T06:30:00.000Z" }]);
    await expect(page.locator(".new-schedule")).toHaveCount(0);
    await expect(page).toHaveScreenshot("trip-added.png");
  });

  await test.step("edit the trip level to 85%", async () => {
    await page.locator(".v-dialog--active button:has(i.mdi-lightning-bolt)").click();
    await dragSlider(page, 85);
    await expect.poll(trips).toEqual([{ type: "Trip", level: 85, time: "2026-01-16T06:30:00.000Z" }]);
  });

  await test.step("the vehicle page plans for the trip", async () => {
    await page.locator(".v-dialog--active button:has(i.mdi-chevron-left)").click();
    await expect(page.locator("#timechart svg")).toBeVisible();
    // Closing the dialog gives focus back to the Schedule button, which opens its tooltip
    await page.evaluate(() => document.activeElement.blur());
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page).toHaveScreenshot("vehicle-with-trip.png", { fullPage: true });
  });

  await test.step("remove the trip", async () => {
    await page.locator("button:has(i.mdi-calendar-clock)").click();
    await page.locator(".v-dialog--active button:has(i.mdi-calendar-remove-outline)").click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect.poll(trips).toEqual([]);
  });

  await test.step("the vehicle is back to its seeded state", async () => {
    await expect.poll(async () => `${JSON.stringify(await client.getVehicle(S.ALPHA.id), null, 2)}\n`).toBe(SEEDED_ALPHA);
  });
});
