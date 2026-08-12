import { expect, test } from "@playwright/test";

const publicOrigin = process.env.POKER_PUBLIC_ORIGIN;

test("public HTTP deployment boots without secure-context API crashes", async ({ page }) => {
  test.skip(!publicOrigin, "POKER_PUBLIC_ORIGIN is required for deployment verification");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${publicOrigin}/?deployment-check=${Date.now()}`, { waitUntil: "networkidle" });

  await expect(page.locator("#root > *")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeVisible();
  const version = await page.request.get(`${publicOrigin}/api/version`);
  expect(version.headers()["cache-control"]).toContain("no-store");
  const release = (await version.json() as { release: string }).release;
  expect(release).not.toBe("dev");
  await expect(page.locator("html")).toHaveAttribute("data-release", release);
  const entryResource = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => /\/assets\/index-.*\.js/.test(name)));
  expect(entryResource).toContain(release);
  expect(pageErrors).toEqual([]);
});
