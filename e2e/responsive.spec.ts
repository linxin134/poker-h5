import { expect, test } from "@playwright/test";

const mobileSizes = [
  { width: 390, height: 660 },
  { width: 360, height: 780 },
  { width: 390, height: 845 },
  { width: 430, height: 932 }
];

test("常见手机比例下大厅、建房和登录弹层不横向溢出", async ({ page }) => {
  for (const size of mobileSizes) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByLabel("房间列表")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "大厅导航" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "创建房间" }).click();
    await expect(page.getByRole("heading", { name: "德州" })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录后创建" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "返回" }).click();

    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "欢迎回到牌桌" })).toBeVisible();
    await expect(page.locator(".auth-modal .modal-close .ui-icon")).toBeVisible();
    const modal = await page.locator(".auth-modal").boundingBox();
    expect(modal).not.toBeNull();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(size.width);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "关闭" }).click();
  }
});

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
