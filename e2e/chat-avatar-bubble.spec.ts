import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:5173";
const message = "河牌见真章，这条消息会自动换行";

async function register(context: BrowserContext, stamp: string, index: number) {
  const nickname = `聊天玩家${index}${stamp.slice(-4)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data: { email:`chat-ui-${index}-${stamp}@local.test`, password:"test-pass-123", nickname }
  });
  expect(response.ok()).toBe(true);
  return nickname;
}

async function joinRoom(page: Page, context: BrowserContext, code: string) {
  expect((await context.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
  await page.goto(origin);
  await page.evaluate((roomCode) => {
    sessionStorage.setItem("poker-active-room", roomCode);
    location.reload();
  }, code);
  await expect(page.locator(".waiting-table-stage")).toBeVisible();
}

function seatGeometry(page: Page, seatId: string) {
  return page.locator(`.seat[data-seat-id="${seatId}"]`).evaluate((seat) => {
    const box = (selector: string) => {
      const element = seat.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x:rect.x, y:rect.y, width:rect.width, height:rect.height, top:rect.top, right:rect.right, bottom:rect.bottom, left:rect.left };
    };
    return { seat:box(":scope"), avatar:box(".avatar-ring"), cards:box(".seat-cards"), bet:box(".seat-bet") };
  });
}

function expectStableGeometry(actual: Awaited<ReturnType<typeof seatGeometry>>, expected: Awaited<ReturnType<typeof seatGeometry>>) {
  for (const key of ["seat", "avatar", "cards"] as const) expect(actual[key]).toEqual(expected[key]);
  if (!expected.bet) expect(actual.bet).toBeNull();
  else {
    expect(actual.bet).not.toBeNull();
    expect(actual.bet!.top).toBeCloseTo(expected.bet.top, 1);
    expect(actual.bet!.bottom).toBeCloseTo(expected.bet.bottom, 1);
    expect(actual.bet!.right).toBeCloseTo(expected.bet.right, 1);
  }
}

function waitingSeatGeometry(page: Page, seatId: string) {
  return page.locator(`.waiting-table-seat[data-seat-id="${seatId}"]`).evaluate((seat) => {
    const box = (selector: string) => {
      const element = seat.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x:rect.x, y:rect.y, width:rect.width, height:rect.height, top:rect.top, right:rect.right, bottom:rect.bottom, left:rect.left };
    };
    return { seat:box(":scope"), avatar:box(":scope > span"), name:box(":scope > b"), meta:box(":scope > small") };
  });
}

function expectStableWaitingGeometry(actual: Awaited<ReturnType<typeof waitingSeatGeometry>>, expected: Awaited<ReturnType<typeof waitingSeatGeometry>>) {
  for (const key of ["seat", "avatar", "name", "meta"] as const) {
    if (!actual[key] || !expected[key]) {
      expect(actual[key]).toEqual(expected[key]);
      continue;
    }
    for (const property of ["x", "y", "width", "height", "top", "right", "bottom", "left"] as const) {
      expect(actual[key][property]).toBeCloseTo(expected[key][property], 0);
    }
  }
}

test("only receivers see seated chat above a stable opponent avatar while history persists", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "390x660 multiplayer chat bubble coverage");
  test.setTimeout(60_000);
  await page.setViewportSize({ width:390, height:660 });
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  const contexts = [page.context(), await browser.newContext({ viewport:{ width:390, height:660 } }), await browser.newContext({ viewport:{ width:390, height:660 } })];
  const pages = [page, await contexts[1].newPage(), await contexts[2].newPage()];
  try {
    const nicknames = await Promise.all(contexts.map((context, index) => register(context, stamp, index)));
    const hostNickname = nicknames[0];
    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    const { code } = await created.json() as { code:string };
    await page.goto(origin);
    await page.evaluate((roomCode) => {
      sessionStorage.setItem("poker-active-room", roomCode);
      location.reload();
    }, code);
    await expect(page.locator(".waiting-table-stage")).toBeVisible();
    for (let index = 1; index < pages.length; index += 1) await joinRoom(pages[index], contexts[index], code);

    await page.locator(".waiting-table-seat.empty").nth(0).click();
    await pages[1].locator(".waiting-table-seat.empty").nth(0).click();
    await pages[2].locator(".waiting-table-seat.empty").nth(0).click();
    await expect(page.getByRole("button", { name:/开始牌局/ })).toBeEnabled();
    await page.getByRole("button", { name:/开始牌局/ }).click();
    for (const client of pages) await expect(client.locator(".fresh-table")).toBeVisible();

    const sender = pages[1];
    const senderSeatId = await sender.locator(".hero-seat").getAttribute("data-seat-id");
    expect(senderSeatId).toBeTruthy();
    const before = await Promise.all(pages.map((client) => seatGeometry(client, senderSeatId!)));

    await sender.locator(".table-bottom-tools").getByRole("button", { name:"聊天" }).click();
    await sender.getByLabel("聊天内容").fill(message);
    await sender.getByRole("button", { name:"发送", exact:true }).click();

    await expect(sender.locator(".seat-chat-bubble")).toHaveCount(0);
    for (const index of [0, 2]) {
      const client = pages[index];
      const bubble = client.locator(`.seat[data-seat-id="${senderSeatId}"] .seat-chat-bubble`);
      await expect(bubble).toHaveText(message);
      const geometry = await client.locator(`.seat[data-seat-id="${senderSeatId}"]`).evaluate((seat) => {
        const bubbleElement = seat.querySelector<HTMLElement>(".seat-chat-bubble")!;
        const bubble = bubbleElement.getBoundingClientRect();
        const avatar = seat.querySelector<HTMLElement>(".avatar-ring")!.getBoundingClientRect();
        const bubbleStyle = getComputedStyle(bubbleElement);
        const blocked = [".seat-name", ".action-bubble", ".seat-bet", ".timer-ring"]
          .flatMap((selector) => {
            const element = seat.querySelector<HTMLElement>(selector);
            if (!element) return [];
            const rect = element.getBoundingClientRect();
            return bubble.left < rect.right && bubble.right > rect.left && bubble.top < rect.bottom && bubble.bottom > rect.top ? [selector] : [];
          });
        return {
          centerDelta:Math.abs((bubble.left + bubble.width / 2) - (avatar.left + avatar.width / 2)),
          gap:avatar.top - bubble.bottom,
          blocked,
          inside:bubble.left >= 0 && bubble.right <= innerWidth && bubble.top >= 0 && bubble.bottom <= innerHeight,
          backgroundColor:bubbleStyle.backgroundColor,
          color:bubbleStyle.color
        };
      });
      expect(geometry.centerDelta).toBeLessThanOrEqual(2);
      expect(geometry.gap).toBeGreaterThanOrEqual(4);
      expect(geometry.blocked).toEqual([]);
      expect(geometry.inside).toBe(true);
      expect(geometry.backgroundColor).toBe("rgba(6, 17, 13, 0.88)");
      expect(geometry.color).toBe("rgb(255, 255, 255)");
      expectStableGeometry(await seatGeometry(client, senderSeatId!), before[index]);
    }
    expectStableGeometry(await seatGeometry(sender, senderSeatId!), before[1]);

    await sender.locator(".game-drawer .panel-close").click();
    await expect(sender.locator(".game-drawer")).toHaveCount(0);
    await pages[0].screenshot({ path:"qa-screenshots/chat-avatar-bubble-receiver-390x660.png" });
    await sender.locator(".table-bottom-tools").getByRole("button", { name:"聊天" }).click();
    await expect(sender.locator(".wpk-chat-messages .mine p").last()).toHaveText(message);
    await sender.locator(".game-drawer .panel-close").click();
    await page.locator(".table-bottom-tools").getByRole("button", { name:"聊天" }).click();
    await expect(page.locator(".wpk-chat-messages .other p").last()).toHaveText(message);
    await page.locator(".game-drawer .panel-close").click();

    await expect(pages[0].locator(".seat-chat-bubble")).toHaveCount(0, { timeout:4_000 });
    await expect(pages[1].locator(".seat-chat-bubble")).toHaveCount(0);
    await expect(pages[2].locator(".seat-chat-bubble")).toHaveCount(0);
    for (let index = 0; index < pages.length; index += 1) expectStableGeometry(await seatGeometry(pages[index], senderSeatId!), before[index]);
    expect(code).toHaveLength(6);
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});

test("waiting room chat is receiver-only, stable, bounded, and clears after three seconds", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "390x660 waiting-room chat coverage");
  test.setTimeout(60_000);
  await page.setViewportSize({ width:390, height:660 });
  const stamp = `${Date.now()}-${testInfo.workerIndex}-waiting`;
  const contexts = [page.context(), await browser.newContext({ viewport:{ width:390, height:660 } }), await browser.newContext({ viewport:{ width:390, height:660 } })];
  const pages = [page, await contexts[1].newPage(), await contexts[2].newPage()];
  const waitingMessage = "等待房消息会自动换行";
  try {
    await Promise.all(contexts.map((context, index) => register(context, stamp, index + 3)));
    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json() as { code:string };
    await page.goto(origin);
    await page.evaluate((roomCode) => {
      sessionStorage.setItem("poker-active-room", roomCode);
      location.reload();
    }, code);
    await expect(page.locator(".waiting-table-stage")).toBeVisible();
    for (let index = 1; index < pages.length; index += 1) await joinRoom(pages[index], contexts[index], code);

    await page.locator(".waiting-table-seat.empty").first().click();
    await pages[1].locator(".waiting-table-seat.empty").first().click();
    await pages[2].locator(".waiting-table-seat.empty").first().click();
    for (const client of pages) await expect(client.locator(".waiting-table-seat.occupied")).toHaveCount(3);

    const sender = pages[1];
    const senderSeatId = await sender.locator(".waiting-table-seat.mine").getAttribute("data-seat-id");
    expect(senderSeatId).toBeTruthy();
    const before = await Promise.all(pages.map((client) => waitingSeatGeometry(client, senderSeatId!)));

    await sender.locator(".waiting-bottom-tools button").nth(1).click();
    await sender.locator(".wpk-chat-compose input").fill(waitingMessage);
    await sender.locator(".wpk-chat-compose .send").click();

    await expect(sender.locator(".waiting-chat-bubble")).toHaveCount(0);
    for (const index of [0, 2]) {
      const client = pages[index];
      const bubble = client.locator(`.waiting-table-seat[data-seat-id="${senderSeatId}"] .waiting-chat-bubble`);
      await expect(bubble).toHaveText(waitingMessage);
      const geometry = await client.locator(`.waiting-table-seat[data-seat-id="${senderSeatId}"]`).evaluate((seat) => {
        const bubbleElement = seat.querySelector<HTMLElement>(".waiting-chat-bubble")!;
        const bubble = bubbleElement.getBoundingClientRect();
        const avatar = seat.querySelector<HTMLElement>(":scope > span")!.getBoundingClientRect();
        const name = seat.querySelector<HTMLElement>(":scope > b")!.getBoundingClientRect();
        const meta = seat.querySelector<HTMLElement>(":scope > small")!.getBoundingClientRect();
        const style = getComputedStyle(bubbleElement);
        const overlaps = (rect: DOMRect) => bubble.left < rect.right && bubble.right > rect.left && bubble.top < rect.bottom && bubble.bottom > rect.top;
        return {
          centerDelta:Math.abs((bubble.left + bubble.width / 2) - (avatar.left + avatar.width / 2)),
          gap:avatar.top - bubble.bottom,
          blocked:{ avatar:overlaps(avatar), name:overlaps(name), meta:overlaps(meta) },
          inside:bubble.left >= 0 && bubble.right <= innerWidth && bubble.top >= 0 && bubble.bottom <= innerHeight,
          backgroundColor:style.backgroundColor,
          color:style.color,
          lines:Math.round((bubble.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)) / parseFloat(style.lineHeight))
        };
      });
      expect(geometry.centerDelta).toBeLessThanOrEqual(2);
      expect(geometry.gap).toBeGreaterThanOrEqual(4);
      expect(geometry.blocked).toEqual({ avatar:false, name:false, meta:false });
      expect(geometry.inside).toBe(true);
      expect(geometry.backgroundColor).toBe("rgba(6, 17, 13, 0.88)");
      expect(geometry.color).toBe("rgb(255, 255, 255)");
      expect(geometry.lines).toBeLessThanOrEqual(2);
      expectStableWaitingGeometry(await waitingSeatGeometry(client, senderSeatId!), before[index]);
    }
    expectStableWaitingGeometry(await waitingSeatGeometry(sender, senderSeatId!), before[1]);

    await sender.locator(".game-drawer .panel-close").click();
    await expect(sender.locator(".game-drawer")).toHaveCount(0);
    await pages[0].screenshot({ path:"qa-screenshots/chat-waiting-bubble-receiver-390x660.png" });

    await sender.locator(".waiting-bottom-tools button").nth(1).click();
    await expect(sender.locator(".wpk-chat-messages .mine p").last()).toHaveText(waitingMessage);
    await sender.locator(".game-drawer .panel-close").click();
    await pages[0].locator(".waiting-bottom-tools button").nth(1).click();
    await expect(pages[0].locator(".wpk-chat-messages .other p").last()).toHaveText(waitingMessage);
    await pages[0].locator(".game-drawer .panel-close").click();

    for (const client of pages) await expect(client.locator(".waiting-chat-bubble")).toHaveCount(0, { timeout:4_000 });
    for (let index = 0; index < pages.length; index += 1) expectStableWaitingGeometry(await waitingSeatGeometry(pages[index], senderSeatId!), before[index]);
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
