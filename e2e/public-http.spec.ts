import { expect, test } from "@playwright/test";

const publicOrigin = process.env.POKER_PUBLIC_ORIGIN;

test("public HTTP deployment boots without secure-context API crashes", async ({ page }) => {
  test.skip(!publicOrigin, "POKER_PUBLIC_ORIGIN is required for deployment verification");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${publicOrigin}/?deployment-check=${Date.now()}`, { waitUntil: "networkidle" });

  await expect(page.locator("#root > *")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
