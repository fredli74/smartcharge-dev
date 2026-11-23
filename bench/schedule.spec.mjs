// Interaction: a trip schedule is added, edited and removed through the UI the way a user does it (buttons,
// slider drags, the date-time picker). Each step is checked in the backend with the app's own client, and the
// test ends with the vehicle as it found it, so the specs that run after it are unaffected.
import { test, expect, newTrip, openMenu, pickerDay, pickerTime, dragSlider } from "./fixtures.mjs";
import { signedInClient, alphaState, alphaSchedule } from "./client.mjs";

test("trip schedule: add, edit and remove", async ({ page }) => {
  const client = await signedInClient();
  const before = await alphaState(client);
  const trips = () => alphaSchedule(client, "Trip");

  await test.step("add a trip on Friday 07:30 at 90%", async () => {
    const item = await newTrip(page);
    await item.locator("button:has(i.mdi-lightning-bolt)").click();
    await dragSlider(page, openMenu(page), 90);
    await openMenu(page).getByRole("button", { name: "Ok" }).click();
    await item.locator("button:has(i.mdi-clock-start)").click();
    await pickerDay(page, 16).click();
    await pickerTime(page, "hours", "07").click();
    await pickerTime(page, "minutes", "30").click();
    await expect(item.locator("button:has(i.mdi-clock-start)")).toContainText("07:30");
    await item.getByRole("button", { name: "Add" }).click();
    await expect.poll(trips).toEqual([{ level: 90, time: "2026-01-16T06:30:00.000Z" }]);
    await expect(page.locator(".new-schedule")).toHaveCount(0);
    await expect(page).toHaveScreenshot("trip-added.png");
  });

  await test.step("edit the trip level to 85%", async () => {
    await page.locator(".v-dialog--active button:has(i.mdi-lightning-bolt)").click();
    await dragSlider(page, openMenu(page), 85);
    await openMenu(page).getByRole("button", { name: "Ok" }).click();
    await expect.poll(trips).toEqual([{ level: 85, time: "2026-01-16T06:30:00.000Z" }]);
  });

  await test.step("the vehicle page plans for the trip", async () => {
    // The dialog's back button is a chevron on a phone and a cross on a desktop
    await page.locator(".v-dialog--active .v-toolbar button").first().click();
    await expect(page.locator(".v-dialog--active")).toHaveCount(0);
    // The closed dialog gives focus back to the schedule button, and on a desktop leaves the mouse over it; either
    // opens its tooltip, after a delay that races the screenshot. Take the screenshot without it.
    await page.evaluate(() => document.activeElement.blur());
    await page.mouse.move(0, 0);
    await expect(page.locator(".v-tooltip__content.menuable__content__active")).toHaveCount(0);
    await expect(page).toHaveScreenshot("vehicle-with-trip.png", { fullPage: true });
  });

  await test.step("remove the trip", async () => {
    await page.locator("button:has(i.mdi-calendar-clock)").click();
    await page.locator(".v-dialog--active button:has(i.mdi-calendar-remove-outline)").click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect.poll(trips).toEqual([]);
    await expect.poll(() => alphaState(client)).toBe(before);
  });
});
