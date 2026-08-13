import { expect, test } from "@playwright/test";

test("390x660 聊天抽屉缩为原宽度的三分之二且内容自适应", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile chat drawer coverage");
  await page.setViewportSize({ width:390, height:660 });

  const stamp = Date.now();
  const registered = await page.context().request.post("/api/auth/register", {
    data:{ email:`chat-width-${stamp}@local.test`, password:"test-pass-123", nickname:"聊天布局测试" }
  });
  expect(registered.ok()).toBe(true);
  const created = await page.context().request.post("/api/rooms", {
    data:{ durationMinutes:30, capacity:6, startingStack:200, smallBlind:1, bigBlind:2 }
  });
  expect(created.ok()).toBe(true);
  const { code } = await created.json() as { code:string };
  await page.addInitScript((roomCode) => sessionStorage.setItem("poker-active-room", roomCode), code);
  await page.goto("/");

  await page.getByRole("button", { name:"聊天" }).click();
  const drawer = page.locator(".game-drawer.drawer-left.tab-chat");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x ?? -999).toBeCloseTo(0, 0);
  const initialGeometry = await drawer.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const close = element.querySelector<HTMLElement>(".panel-close")!.getBoundingClientRect();
    const compose = element.querySelector<HTMLElement>(".wpk-chat-compose")!.getBoundingClientRect();
    return {
      left:box.left, right:box.right, top:box.top, bottom:box.bottom, width:box.width,
      closeInside:close.left >= box.left && close.right <= box.right && close.top >= box.top && close.bottom <= box.bottom,
      composeInside:compose.left >= box.left && compose.right <= box.right,
      bodyScrollWidth:document.documentElement.scrollWidth,
      viewportWidth:innerWidth
    };
  });
  expect(initialGeometry.left).toBeCloseTo(0, 0);
  expect(initialGeometry.top).toBeCloseTo(0, 0);
  expect(initialGeometry.bottom).toBeCloseTo(660, 0);
  expect(initialGeometry.width).toBeCloseTo(390 * .56, 0);
  expect(initialGeometry.right).toBeCloseTo(initialGeometry.width, 0);
  expect(initialGeometry.closeInside).toBe(true);
  expect(initialGeometry.composeInside).toBe(true);
  expect(initialGeometry.bodyScrollWidth).toBe(initialGeometry.viewportWidth);

  const longMessage = "这是一条用于验证聊天抽屉长消息自动换行且绝不会撑破移动端边界的连续文本内容".repeat(2).slice(0, 80);
  await page.getByLabel("聊天内容").fill(longMessage);
  await page.getByRole("button", { name:"发送", exact:true }).click();
  const message = page.locator(".wpk-chat-messages .mine p").last();
  await expect(message).toHaveText(longMessage);
  const messageGeometry = await message.evaluate((element) => {
    const messageBox = element.getBoundingClientRect();
    const drawerBox = document.querySelector<HTMLElement>(".tab-chat")!.getBoundingClientRect();
    return {
      inside:messageBox.left >= drawerBox.left && messageBox.right <= drawerBox.right,
      wraps:element.getClientRects().length > 1 || messageBox.height > Number.parseFloat(getComputedStyle(element).lineHeight) * 1.5,
      pageHasHorizontalOverflow:document.documentElement.scrollWidth > innerWidth
    };
  });
  expect(messageGeometry.inside).toBe(true);
  expect(messageGeometry.wraps).toBe(true);
  expect(messageGeometry.pageHasHorizontalOverflow).toBe(false);

  await page.screenshot({ path:testInfo.outputPath("chat-drawer-390x660.png") });

  await page.getByRole("button", { name:"关闭" }).click();
  await page.getByRole("button", { name:"计分" }).click();
  const statsDrawer = page.locator(".game-drawer.drawer-left.tab-stats");
  await expect(statsDrawer).toBeVisible();
  await expect.poll(async () => (await statsDrawer.boundingBox())?.x ?? -999).toBeCloseTo(0, 0);
  const statsWidth = (await statsDrawer.boundingBox())!.width;
  expect(statsWidth).toBeCloseTo(390 * .84, 0);
});
