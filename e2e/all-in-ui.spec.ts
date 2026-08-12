import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function register(context: BrowserContext, origin: string, prefix: string, nickname: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const uniqueNickname = `${nickname}${stamp.slice(-4)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data:{ email:`${prefix}-${stamp}@local.test`, password:"test-pass-123", nickname:uniqueNickname }
  });
  expect(response.ok()).toBe(true);
  return uniqueNickname;
}

test("All in 头像覆盖、筹码入池和三环倒计时保持固定布局", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const origin = "http://127.0.0.1:5173";
  await page.setViewportSize({ width:390, height:660 });
  const guestContext = await browser.newContext({ viewport:{ width:390, height:660 } });
  const guestPage = await guestContext.newPage();
  try {
    const hostNickname = await register(page.context(), origin, "allin-host", "全下房主");
    await register(guestContext, origin, "allin-guest", "全下客人");
    const created = await page.context().request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json() as { code:string };

    for (const playerPage of [page, guestPage]) await playerPage.goto("/");
    for (const playerPage of [page, guestPage]) {
      const room = playerPage.locator(".public-room-list article", { hasText:hostNickname });
      await room.getByRole("button", { name:/加入/ }).click();
      await expect(playerPage.locator(".waiting-room")).toBeVisible();
    }
    await page.locator(".waiting-table-seat.empty").first().click();
    await guestPage.locator(".waiting-table-seat.empty").first().click();
    await page.getByRole("button", { name:/开始牌局/ }).click();
    await expect(page.locator(".fresh-table")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("poker-active-room"))).toBe(code);

    const actorPage = await page.locator(".action-dock.my-turn").count() ? page : guestPage;
    const responderPage = actorPage === page ? guestPage : page;
    const heroBefore = await actorPage.locator(".hero-seat .avatar-ring").boundingBox();
    const opponentOrder = await actorPage.locator(".seat.opponent-seat").first().evaluate((seat) => {
      const box = (selector: string) => seat.querySelector(selector)!.getBoundingClientRect();
      const name = box(".seat-name");
      const avatar = box(".avatar-ring");
      const cards = box(".seat-cards");
      const stack = box(".seat-stack");
      return { nameBottom:name.bottom, avatar, cards, stackTop:stack.top };
    });
    expect(opponentOrder.nameBottom).toBeLessThanOrEqual(opponentOrder.avatar.top + 1);
    expect(opponentOrder.cards.left).toBeGreaterThan(opponentOrder.avatar.left + opponentOrder.avatar.width / 2);
    expect(opponentOrder.cards.top).toBeGreaterThan(opponentOrder.avatar.top + opponentOrder.avatar.height / 2);
    expect(opponentOrder.cards.top).toBeLessThan(opponentOrder.avatar.bottom);
    expect(opponentOrder.stackTop).toBeGreaterThanOrEqual(opponentOrder.avatar.bottom);
    const rings = actorPage.locator(".action-buttons .action .action-countdown-orbit");
    await expect(rings).toHaveCount(3);
    const ringData = await rings.evaluateAll((elements) => elements.map((element) => ({
      progress:getComputedStyle(element).getPropertyValue("--action-progress").trim(),
      radius:getComputedStyle(element).borderRadius,
    })));
    expect(ringData.every((entry) => Number(entry.progress) > 0 && entry.radius === "50%")).toBe(true);
    await actorPage.screenshot({ path:testInfo.outputPath("three-ring-countdown-390x660.png") });

    const directAllIn = actorPage.locator(".action.allin");
    if (await directAllIn.count()) await directAllIn.click();
    else {
      await actorPage.locator(".action.raise").dispatchEvent("pointerdown", { pointerType:"touch", isPrimary:true, button:0 });
      await actorPage.locator(".raise-panel input[type=range]").press("End");
      await actorPage.locator(".raise-confirm").click();
    }
    await expect(page.locator(".seat.all-in-seat .all-in-status")).toHaveText("All in");
    await expect(page.locator(".chip-commit-layer")).toBeVisible();
    await expect(page.locator(".seat.all-in-seat .seat-bet i")).toBeVisible();
    const allInSeat = page.locator(".seat.all-in-seat");
    const allInGeometry = await allInSeat.evaluate((seat) => {
      const avatar = seat.querySelector(".avatar-ring")!.getBoundingClientRect();
      const status = seat.querySelector(".all-in-status")!.getBoundingClientRect();
      return {
        centerDelta:Math.hypot(avatar.left + avatar.width / 2 - (status.left + status.width / 2), avatar.top + avatar.height / 2 - (status.top + status.height / 2)),
        status:{ width:status.width, height:status.height },
      };
    });
    expect(allInGeometry.centerDelta).toBeLessThanOrEqual(1);
    expect(allInGeometry.status.width).toBeCloseTo(allInGeometry.status.height, 1);
    const heroAfter = await actorPage.locator(".hero-seat .avatar-ring").boundingBox();
    expect(heroAfter).toEqual(heroBefore);
    await page.screenshot({ path:testInfo.outputPath("all-in-avatar-chip-390x660.png") });

    await expect(responderPage.locator(".action-dock.my-turn")).toBeVisible();
    const allInCall = responderPage.locator(".action.allin");
    const call = responderPage.locator(".action.call");
    const responseAction = await allInCall.count() ? allInCall : call;
    await expect(responseAction).toBeEnabled();
    await responderPage.waitForTimeout(350);
    await responderPage.screenshot({ path:testInfo.outputPath("responder-before-call-390x660.png") });
    const centerTarget = await responseAction.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) as HTMLElement | null;
      return { button:button.className, hit:hit?.className ?? hit?.tagName ?? "none", ancestor:hit?.closest("button")?.className ?? "none", rect:{ left:rect.left, top:rect.top, width:rect.width, height:rect.height } };
    });
    expect(centerTarget.ancestor, JSON.stringify(centerTarget)).toContain("action");
    await responseAction.dispatchEvent("pointerup", { pointerType:"touch", isPrimary:true, button:0 });
    await expect(responderPage.locator(".seat.all-in-seat")).toHaveCount(2, { timeout:5_000 });
    await expect(page.locator('[data-result="showdown"]')).toBeVisible({ timeout:15_000 });
    await expect(page.locator(".board-cards .playing-card:not(.card-back)")).toHaveCount(5);
    await expect(page.locator(".seat:not(.folded) .seat-cards .playing-card:not(.card-back)")).toHaveCount(4);
    await expect(page.locator(".seat:not(.folded) .seat-hand-rank")).toHaveCount(2);
    const revealedOpponent = page.locator(".opponent-seat:not(.folded)").first();
    await expect(revealedOpponent.locator(":scope > .avatar-ring")).toBeHidden();
    await expect(revealedOpponent.locator(":scope > .seat-cards .playing-card:not(.card-back)")).toHaveCount(2);
    await expect(revealedOpponent.locator(":scope > .seat-hand-rank")).toBeVisible();
    await expect(revealedOpponent.locator(":scope > .seat-stack")).toBeHidden();
    const opponentShowdownOrder = await revealedOpponent.evaluate((seat) => {
      const rect = (selector: string) => seat.querySelector(selector)!.getBoundingClientRect();
      return { name:rect(".seat-name"), cards:rect(".seat-cards"), rank:rect(".seat-hand-rank") };
    });
    expect(opponentShowdownOrder.name.bottom).toBeLessThanOrEqual(opponentShowdownOrder.cards.top + 1);
    expect(opponentShowdownOrder.cards.bottom).toBeLessThanOrEqual(opponentShowdownOrder.rank.top + 1);
    const winnerPage = await page.locator(".showdown-win-label").count() ? page : guestPage;
    await expect(winnerPage.locator(".showdown-win-label")).toHaveText("YOU WIN!");
    expect(await winnerPage.locator(".pot-award-layer .pot-award-coin").count()).toBeGreaterThanOrEqual(9);
    // Card dealing and reveal use short motion transitions. Assert the final
    // reference layout rather than an intermediate flight frame.
    await winnerPage.waitForTimeout(700);
    const showdownOrder = await winnerPage.locator(".hero-seat").evaluate((seat) => {
      const rect = (selector: string) => seat.querySelector(selector)!.getBoundingClientRect();
      return { cards:rect(".seat-cards"), rank:rect(".seat-hand-rank"), stack:rect(".seat-stack") };
    });
    expect(showdownOrder.cards.bottom).toBeLessThanOrEqual(showdownOrder.rank.top + 1);
    expect(showdownOrder.rank.bottom).toBeLessThanOrEqual(showdownOrder.stack.top + 1);
    await winnerPage.screenshot({ path:testInfo.outputPath("showdown-award-390x660.png") });
  } finally {
    await guestContext.close();
  }
});
