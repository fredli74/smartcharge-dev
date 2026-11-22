// Interaction: a trip schedule is added, edited and removed through the UI the way a user does it (buttons,
// slider drags, the date-time picker). Each step is checked in the backend with the app's own client, and the
// test ends with the vehicle exactly as seeded, so the specs that run after it are unaffected.
import { test, expect, openVehicle, dragSlider } from "./fixtures.mjs";
import { signedInClient, SEEDED_ALPHA } from "./client.mjs";
import * as S from "./scenario.mjs";

test("trip schedule: add, edit and remove", async ({ page }) => {
  const client = await signedInClient();
  // The seeded vehicle also carries the planner's own AI entry; only trips are the user's
  const trips = async () => (await client.getVehicle(S.ALPHA.id)).schedule
    .filter((s) => s.type === "Trip").map(({ type, level, time }) => ({ type, level, time }));

  await openVehicle(page, S.ALPHA);
  await page.locator("button:has(i.mdi-calendar-clock)").click();

  await test.step("add a trip on Friday 07:30 at 90%", async () => {
    await page.getByRole("button", { name: "add trip" }).click();
    const item = page.locator(".new-schedule");
    await item.locator("button:has(i.mdi-lightning-bolt)").click();
    const menu = page.locator(".menuable__content__active");
    await dragSlider(page, menu, 90);
    await menu.getByRole("button", { name: "Ok" }).click();
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
    const menu = page.locator(".menuable__content__active");
    await dragSlider(page, menu, 85);
    await menu.getByRole("button", { name: "Ok" }).click();
    await expect.poll(trips).toEqual([{ type: "Trip", level: 85, time: "2026-01-16T06:30:00.000Z" }]);
  });

  await test.step("the vehicle page plans for the trip", async () => {
    // The dialog's back button is a chevron on a phone and a cross on a desktop
    await page.locator(".v-dialog--active .v-toolbar button").first().click();
    await expect(page.locator(".v-dialog--active")).toHaveCount(0);
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
