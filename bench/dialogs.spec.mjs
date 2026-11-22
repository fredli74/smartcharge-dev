// The parts of the vehicle dialogs on their own: the level slider, the date-time picker and the charge
// control buttons. Every test ends with the vehicle as it found it.
import { test, expect, openVehicle, newTrip, openMenu, pickerDay, pickerTime, dragSlider } from "./fixtures.mjs";
import { signedInClient, alphaState, alphaSchedule } from "./client.mjs";
import * as S from "./scenario.mjs";

test("level slider: limits, warning above maximum, cancel", async ({ page }) => {
  const client = await signedInClient();
  const before = await alphaState(client);
  const item = await newTrip(page);
  const level = item.locator("button:has(i.mdi-lightning-bolt)");
  await expect(level).toContainText("80%");
  await level.click();
  const menu = openMenu(page);
  const slider = menu.locator("[role=slider]");

  await test.step("it stops at the direct charge level", async () => {
    await dragSlider(page, menu, 0);
    await expect(slider).toHaveAttribute("aria-valuenow", "15");
  });
  await test.step("it stops at 100%", async () => {
    await dragSlider(page, menu, 120);
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
  });
  await test.step("above the vehicle's maximum it turns to the warning colour", async () => {
    await dragSlider(page, menu, 95);
    await expect(slider).toHaveAttribute("aria-valuenow", "95");
    await expect(menu).toHaveScreenshot("level-above-maximum.png");
  });
  await test.step("cancel keeps the level", async () => {
    await menu.getByRole("button", { name: "Cancel" }).click();
    await expect(level).toContainText("80%");
  });
  await test.step("an unsaved trip leaves nothing behind", async () => {
    await item.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".new-schedule")).toHaveCount(0);
    expect(await alphaState(client)).toBe(before);
  });
});

test("date-time picker: past disabled, month navigation, minute steps, cancel", async ({ page }) => {
  const client = await signedInClient();
  const before = await alphaState(client);
  const item = await newTrip(page);
  const time = item.locator("button:has(i.mdi-clock-start)");
  const shown = (await time.textContent()).trim(); // innerText would be CSS-uppercased
  await time.click();
  const picker = openMenu(page);

  await test.step("days before today are disabled", async () => {
    await expect(pickerDay(page, 13)).toHaveClass(/--disabled/);
    await expect(pickerDay(page, 14)).not.toHaveClass(/--disabled/);
    await expect(picker).toHaveScreenshot("calendar.png");
  });
  await test.step("the month can be changed and changed back", async () => {
    const month = picker.locator(".vdatetime-calendar__current--month");
    await picker.locator(".vdatetime-calendar__navigation--next").click();
    await expect(month).toHaveText("Februari 2026");
    await picker.locator(".vdatetime-calendar__navigation--previous").click();
    await expect(month).toHaveText("Januari 2026");
  });
  await test.step("today's past hours are disabled", async () => {
    await pickerDay(page, 14).click();
    await expect(pickerTime(page, "hours", "13")).toHaveClass(/--disabled/);
    await expect(pickerTime(page, "hours", "15")).not.toHaveClass(/--disabled/);
  });
  await test.step("minutes come in steps of ten", async () => {
    await expect(picker.locator(".vdatetime-time-picker__list--minutes .vdatetime-time-picker__item"))
      .toHaveText(["00", "10", "20", "30", "40", "50"]);
  });
  await test.step("cancel keeps the time", async () => {
    await picker.locator(".vdatetime-popup__actions__button--cancel").click();
    await expect(time).toHaveText(shown);
  });
  await test.step("an unsaved trip leaves nothing behind", async () => {
    await item.getByRole("button", { name: "Cancel" }).click();
    expect(await alphaState(client)).toBe(before);
  });
});

test("charge control: start with a level, stop, back to smart charge", async ({ page }) => {
  const client = await signedInClient();
  const before = await alphaState(client);
  const manual = () => alphaSchedule(client, "Manual");
  await openVehicle(page, S.ALPHA);
  await page.locator("#vehicle-actions button:has(i.mdi-lightning-bolt)").click();
  const dialog = page.locator(".v-dialog--active");
  const mode = (name) => dialog.locator(".v-btn-toggle").getByRole("button", { name });

  await test.step("smart charge is selected and shows the plan's target", async () => {
    await expect(mode("Smart Charge")).toHaveClass(/selected-charge/);
    await expect(dialog).toContainText("Charging to 42% before");
    await expect(dialog).toHaveScreenshot("charge-smart.png");
  });
  await test.step("start charges directly to the vehicle's maximum", async () => {
    await mode("Start").click();
    await expect.poll(manual).toEqual([{ level: 80, time: null }]);
    await expect(dialog).toContainText("Direct charging to 80%");
  });
  await test.step("the slider sets the level", async () => {
    await dragSlider(page, dialog, 90);
    await expect.poll(manual).toEqual([{ level: 90, time: null }]);
    await expect(dialog).toContainText("Direct charging to 90%");
    await expect(dialog).toHaveScreenshot("charge-start.png");
  });
  await test.step("stop disables charging", async () => {
    await mode("Stop").click();
    await expect.poll(manual).toEqual([{ level: null, time: null }]);
    await expect(dialog).toContainText("Charging is disabled until you plug in next time");
  });
  await test.step("smart charge removes the override", async () => {
    await mode("Smart Charge").click();
    await expect.poll(manual).toEqual([]);
    await expect.poll(() => alphaState(client)).toBe(before);
  });
});
