import { expect, test } from "@playwright/test";

test("390x660 表情面板关闭按钮对齐并支持外部区域与 Esc 关闭", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile interaction panel coverage");
  await page.setViewportSize({ width: 390, height: 660 });

  const stamp = Date.now();
  const registered = await page.context().request.post("/api/auth/register", {
    data: { email: `emoji-panel-${stamp}@local.test`, password: "test-pass-123", nickname: "表情面板测试" }
  });
  expect(registered.ok()).toBe(true);
  const created = await page.context().request.post("/api/rooms", {
    data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 }
  });
  expect(created.ok()).toBe(true);
  const { code } = await created.json() as { code: string };
  await page.addInitScript((roomCode) => window.sessionStorage.setItem("poker-active-room", roomCode), code);
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "发送互动表情" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const panel = page.getByRole("dialog", { name: "互动表情" });
  const close = page.getByRole("button", { name: "关闭表情面板" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".emoji-popover-backdrop")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const panelBox = document.querySelector<HTMLElement>(".interaction-popover")!.getBoundingClientRect();
    const headerBox = document.querySelector<HTMLElement>(".interaction-popover>header")!.getBoundingClientRect();
    const navBox = document.querySelector<HTMLElement>(".interaction-popover>header nav")!.getBoundingClientRect();
    const closeBox = document.querySelector<HTMLElement>(".interaction-popover .popover-close")!.getBoundingClientRect();
    return {
      panel: { left: panelBox.left, right: panelBox.right, bottom: panelBox.bottom },
      close: { left: closeBox.left, right: closeBox.right, top: closeBox.top, bottom: closeBox.bottom, width: closeBox.width, height: closeBox.height },
      headerCenter: headerBox.top + headerBox.height / 2,
      closeCenter: closeBox.top + closeBox.height / 2,
      tabGap: closeBox.left - navBox.right
    };
  });
  expect(geometry.panel.left).toBeGreaterThanOrEqual(8);
  expect(geometry.panel.right).toBeLessThanOrEqual(382);
  expect(geometry.panel.bottom).toBeLessThanOrEqual(660);
  expect(geometry.close.width).toBe(32);
  expect(geometry.close.height).toBe(32);
  expect(Math.abs(geometry.headerCenter - geometry.closeCenter)).toBeLessThan(1);
  expect(geometry.tabGap).toBeGreaterThanOrEqual(8);
  expect(geometry.close.left).toBeGreaterThanOrEqual(geometry.panel.left);
  expect(geometry.close.right).toBeLessThanOrEqual(geometry.panel.right);
  await page.screenshot({ path: testInfo.outputPath("emoji-panel-open-390x660.png") });

  await panel.getByRole("button", { name: "互动", exact: true }).click();
  await expect(panel).toBeVisible();
  await page.locator(".emoji-popover-backdrop").click({ position: { x: 20, y: 100 } });
  await expect(panel).toBeHidden();

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await trigger.click();
  await close.click();
  await expect(panel).toBeHidden();
});

test("目标列表变化后表情面板不会保留或发送旧座位", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile interaction target coverage");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 660 });
  const origin = "http://127.0.0.1:5173";
  const guestOne = await browser.newContext({ viewport: { width: 390, height: 660 } });
  const guestTwo = await browser.newContext({ viewport: { width: 390, height: 660 } });
  const guestOnePage = await guestOne.newPage();
  const guestTwoPage = await guestTwo.newPage();
  const contexts = [page.context(), guestOne, guestTwo];
  const pages = [page, guestOnePage, guestTwoPage];
  const stamp = Date.now();
  const nicknames = [`目标房主${stamp.toString(36).slice(-3)}`, `旧目标${stamp.toString(36).slice(-3)}`, `新目标${stamp.toString(36).slice(-3)}`];
  try {
    for (let index = 0; index < contexts.length; index += 1) {
      const response = await contexts[index].request.post(`${origin}/api/auth/register`, {
        data: { email: `emoji-target-${index}-${stamp}@local.test`, password: "test-pass-123", nickname: nicknames[index] }
      });
      expect(response.ok()).toBe(true);
    }
    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data: { durationMinutes: 30, capacity: 3, startingStack: 200, smallBlind: 1, bigBlind: 2 }
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json() as { code: string };
    for (const context of contexts.slice(1)) expect((await context.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    for (const playerPage of pages) {
      await playerPage.addInitScript((roomCode) => {
        window.sessionStorage.setItem("poker-active-room", roomCode);
        const sent: unknown[] = [];
        (window as typeof window & { __emojiSent?: unknown[] }).__emojiSent = sent;
        const nativeSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function (payload) {
          try { sent.push(JSON.parse(String(payload))); } catch { /* non-JSON payload */ }
          return nativeSend.call(this, payload);
        };
      }, code);
      await playerPage.goto("/");
      await expect(playerPage.locator(".waiting-room")).toBeVisible();
      await playerPage.locator(".waiting-table-seat.empty").first().click();
    }

    const roomResponse = await contexts[0].request.get(`${origin}/api/rooms/${code}`);
    const roomBody = await roomResponse.json() as { room: { members: Array<{ nickname: string; seatId: string }> } };
    const oldSeatId = roomBody.room.members.find((member) => member.nickname === nicknames[1])!.seatId;
    const newSeatId = roomBody.room.members.find((member) => member.nickname === nicknames[2])!.seatId;

    const trigger = page.getByRole("button", { name: "发送互动表情" });
    await trigger.click();
    await page.getByRole("dialog", { name: "互动表情" }).getByRole("button", { name: "互动", exact: true }).click();
    await page.getByRole("button", { name: nicknames[1], exact: true }).click();
    await expect(page.getByRole("button", { name: nicknames[1], exact: true })).toHaveClass(/active/);

    await guestOnePage.getByRole("button", { name: "牌桌功能" }).click();
    await guestOnePage.getByRole("button", { name: "站起旁观" }).click();
    await expect(page.getByRole("button", { name: nicknames[1], exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: nicknames[2], exact: true })).toHaveClass(/active/);
    await page.locator(".emoji-grid button").first().click();

    const payloads = await page.evaluate(() => (window as typeof window & { __emojiSent: Array<{ type?: string; targetSeatId?: string }> }).__emojiSent);
    const sentEmoji = payloads.filter((payload) => payload.type === "emoji");
    expect(sentEmoji).toHaveLength(1);
    expect(sentEmoji[0].targetSeatId).toBe(newSeatId);
    expect(sentEmoji[0].targetSeatId).not.toBe(oldSeatId);
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
