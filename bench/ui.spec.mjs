// Visual regression: the built app against the seeded server, with the browser frozen at the anchor.
import { test, expect, signIn, openVehicle, imagesLoaded } from "./fixtures.mjs";
import * as S from "./scenario.mjs";

test("login", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveScreenshot("login.png");
});

test("vehicle list", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByText(S.BETA.name)).toBeVisible();
  await imagesLoaded(page);
  await expect(page).toHaveScreenshot("home.png", { fullPage: true });
});

for (const vehicle of [S.ALPHA, S.BETA]) {
  test(`vehicle ${vehicle.name}`, async ({ page }) => {
    await openVehicle(page, vehicle);
    await imagesLoaded(page);
    await expect(page).toHaveScreenshot(`vehicle-${vehicle.name.split(" ")[1].toLowerCase()}.png`, { fullPage: true });
  });
}

test("settings", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(page).toHaveScreenshot("settings.png", { fullPage: true });
});
