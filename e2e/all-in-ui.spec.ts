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

function readHeroParts(targetPage: Page) {
  return targetPage.locator(".hero-seat").evaluate((seat) => {
    const rect = (selector:string) => {
      const element = seat.querySelector<HTMLElement>(selector)!;
      const box = element.getBoundingClientRect();
      return { left:box.left, top:box.top, width:box.width, height:box.height };
    };
    return [".avatar-ring", ".seat-cards", ".seat-hand-rank", ".seat-stack"].map(rect);
  });
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
    const preactions = responderPage.locator(".action-dock.waiting-turn .preaction-buttons button");
    await expect(preactions).toHaveCount(2);
    await expect(preactions.nth(0)).toHaveAccessibleName("让或弃");
    await expect(preactions.nth(1)).toHaveAccessibleName(/跟注/);
    await expect(responderPage.locator(".preaction-buttons")).not.toContainText("自动让牌");
    if (await preactions.nth(1).isEnabled()) {
      const callAmount = Number((await preactions.nth(1).locator("b").textContent())?.replace(/,/g, ""));
      expect(callAmount).toBeGreaterThan(0);
      await preactions.nth(1).click();
      await expect(preactions.nth(1)).toHaveAttribute("aria-pressed", "true");
      await preactions.nth(1).click();
      await expect(preactions.nth(1)).toHaveAttribute("aria-pressed", "false");
    } else {
      await expect(preactions.nth(1)).toHaveAccessibleName("跟注");
    }
    // Wait for the initial deal animation to settle, then use this exact player
    // and hand as the baseline for the later waiting -> my-turn comparison.
    await responderPage.waitForTimeout(700);
    const responderHeroBeforeTurn = await readHeroParts(responderPage);
    const preactionGeometry = await preactions.evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { width:rect.width, height:rect.height, radius:style.borderRadius, x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
    }));
    expect(preactionGeometry.every((entry) => Math.abs(entry.width - entry.height) <= .5 && entry.radius === "50%")).toBe(true);
    expect(preactionGeometry[0].y).toBeCloseTo(preactionGeometry[1].y, 1);
    expect(preactionGeometry[1].x - preactionGeometry[0].x).toBeGreaterThanOrEqual(120);
    await responderPage.screenshot({ path:testInfo.outputPath("preaction-circles-390x660.png") });
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
    expect(opponentOrder.cards.left).toBeGreaterThanOrEqual(opponentOrder.avatar.left + opponentOrder.avatar.width / 2 - 1);
    expect(opponentOrder.cards.top).toBeGreaterThan(opponentOrder.avatar.top + opponentOrder.avatar.height / 2);
    expect(opponentOrder.cards.top).toBeLessThan(opponentOrder.avatar.bottom);
    expect(opponentOrder.stackTop).toBeGreaterThanOrEqual(opponentOrder.avatar.bottom);
    const rings = actorPage.locator(".action-buttons .action .action-countdown-orbit");
    await expect(rings).toHaveCount(3);
    const readCountdownState = () => actorPage.locator(".action-buttons .action").evaluateAll((buttons) => buttons.map((button) => {
      const element = button.querySelector<HTMLElement>(".action-countdown-orbit")!;
      const ring = element.getBoundingClientRect();
      const action = button.getBoundingClientRect();
      const dot = element.querySelector<HTMLElement>(".action-countdown-dot")!.getBoundingClientRect();
      return {
        progress:getComputedStyle(element).getPropertyValue("--action-progress").trim(),
        radius:getComputedStyle(element).borderRadius,
        sector:getComputedStyle(element).backgroundImage,
        centerDelta:Math.hypot(ring.left + ring.width / 2 - (action.left + action.width / 2), ring.top + ring.height / 2 - (action.top + action.height / 2)),
        widthDelta:ring.width - action.width,
        heightDelta:ring.height - action.height,
        dotRadius:Math.hypot(dot.left + dot.width / 2 - (action.left + action.width / 2), dot.top + dot.height / 2 - (action.top + action.height / 2)),
        expectedDotRadius:action.width / 2 + 4,
        dotAngle:Math.atan2(dot.top + dot.height / 2 - (action.top + action.height / 2), dot.left + dot.width / 2 - (action.left + action.width / 2)),
        action:{ left:action.left, top:action.top, width:action.width, height:action.height },
      };
    }));
    const stableHeroParts = () => readHeroParts(actorPage);
    const ringData = await readCountdownState();
    expect(ringData.every((entry) => Number(entry.progress) > 0 && entry.radius === "50%")).toBe(true);
    expect(ringData.every((entry) => entry.sector.includes("conic-gradient"))).toBe(true);
    expect(ringData.every((entry) => entry.centerDelta <= .5)).toBe(true);
    expect(ringData.every((entry) => Math.abs(entry.widthDelta - 8) <= .5 && Math.abs(entry.heightDelta - 8) <= .5), JSON.stringify(ringData)).toBe(true);
    expect(ringData.every((entry) => Math.abs(entry.dotRadius - entry.expectedDotRadius) <= 1.5)).toBe(true);
    const actionOverlapCount = await actorPage.locator(".action-buttons .action").evaluateAll((buttons) => {
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      const overlaps = (a:DOMRect, b:DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return boxes.flatMap((box, index) => boxes.slice(index + 1).filter((other) => overlaps(box, other))).length;
    });
    expect(actionOverlapCount).toBe(0);
    const actionCardOverlapCount = await actorPage.evaluate(() => {
      const actions = [...document.querySelectorAll<HTMLElement>(".action-buttons .action-countdown-orbit")].map((element) => element.getBoundingClientRect());
      const cards = [...document.querySelectorAll<HTMLElement>(".hero-seat>.seat-cards .playing-card")].map((element) => element.getBoundingClientRect());
      const overlaps = (a:DOMRect, b:DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return actions.flatMap((action) => cards.filter((card) => overlaps(action, card))).length;
    });
    expect(actionCardOverlapCount).toBe(0);
    const actionClearance = await actorPage.evaluate(() => {
      const ringBoxes = [...document.querySelectorAll<HTMLElement>(".action-buttons .action-countdown-orbit")].map((element) => element.getBoundingClientRect());
      const cardBoxes = [...document.querySelectorAll<HTMLElement>(".hero-seat>.seat-cards .playing-card")].map((element) => element.getBoundingClientRect());
      const gap = (a:DOMRect, b:DOMRect) => Math.hypot(Math.max(a.left - b.right, b.left - a.right, 0), Math.max(a.top - b.bottom, b.top - a.bottom, 0));
      return Math.min(...ringBoxes.flatMap((ring) => cardBoxes.map((card) => gap(ring, card))));
    });
    expect(actionClearance).toBeGreaterThanOrEqual(6);
    await expect(actorPage.locator(".action-arc")).not.toContainText(/BB/i);
    const mainArc = await actorPage.locator(".action-buttons .action").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
    }).sort((a,b) => a.x - b.x));
    expect(mainArc[0].y).toBeCloseTo(mainArc[2].y, 1);
    expect(mainArc[0].y - mainArc[1].y).toBeGreaterThanOrEqual(24);
    const heroPartsBeforeTick = await stableHeroParts();
    await actorPage.waitForTimeout(600);
    const ringDataAfterTick = await readCountdownState();
    const heroPartsAfterTick = await stableHeroParts();
    expect(heroPartsAfterTick).toEqual(heroPartsBeforeTick);
    expect(ringDataAfterTick.map((entry) => entry.action)).toEqual(ringData.map((entry) => entry.action));
    ringDataAfterTick.forEach((entry, index) => {
      expect(Number(entry.progress)).toBeLessThan(Number(ringData[index].progress));
      expect(entry.sector).not.toBe(ringData[index].sector);
      expect(Math.abs(entry.dotAngle - ringData[index].dotAngle)).toBeGreaterThan(.01);
    });
    await actorPage.screenshot({ path:testInfo.outputPath("three-ring-countdown-390x660.png") });

    const directAllIn = actorPage.locator(".action.allin");
    const raise = actorPage.locator(".action.raise");
    if (await raise.count()) {
      const heroChildrenBeforeRail = await actorPage.locator(".hero-seat").evaluate((seat) => {
        const rect = (selector:string) => {
          const element = seat.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { left:box.left, top:box.top, width:box.width, height:box.height };
        };
        return [".seat-name", ".avatar-ring", ".seat-cards", ".seat-hand-rank", ".seat-stack"].map(rect);
      });
      await actorPage.locator(".action.raise").dispatchEvent("pointerdown", { pointerType:"touch", isPrimary:true, button:0 });
      await expect(actorPage.locator(".raise-panel.raise-rail")).toBeVisible();
      const railGeometry = await actorPage.evaluate(() => {
        const box = (selector:string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const hero = box(".hero-seat .avatar-ring");
        const confirm = box(".raise-confirm");
        const backdrop = box(".raise-backdrop");
        const header = box(".raise-panel header");
        const percent = box(".raise-percent");
        const handle = box(".raise-handle");
        const viewport = { width:innerWidth, height:innerHeight };
        const inside = (rect:DOMRect) => rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height;
        return {
          confirmDelta:Math.hypot(confirm.left + confirm.width / 2 - (hero.left + hero.width / 2), confirm.top + confirm.height / 2 - (hero.top + hero.height / 2)),
          backdrop:{ left:backdrop.left, top:backdrop.top, right:backdrop.right, bottom:backdrop.bottom },
          controlsInside:[header, percent, handle, confirm].every(inside),
          headerAboveHandle:header.bottom <= handle.top,
          percentLeftOfRail:percent.right <= handle.left,
        };
      });
      expect(railGeometry.confirmDelta).toBeCloseTo(12, 1);
      expect(railGeometry.backdrop).toEqual({ left:0, top:0, right:390, bottom:660 });
      expect(railGeometry.controlsInside).toBe(true);
      expect(railGeometry.headerAboveHandle).toBe(true);
      expect(railGeometry.percentLeftOfRail).toBe(true);
      const heroChildrenWithRail = await actorPage.locator(".hero-seat").evaluate((seat) => {
        const rect = (selector:string) => {
          const element = seat.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { left:box.left, top:box.top, width:box.width, height:box.height };
        };
        return [".seat-name", ".avatar-ring", ".seat-cards", ".seat-hand-rank", ".seat-stack"].map(rect);
      });
      expect(heroChildrenWithRail).toEqual(heroChildrenBeforeRail);
      await actorPage.locator(".raise-panel input[type=range]").press("End");
      await actorPage.locator(".raise-confirm").click();
    } else await directAllIn.click();
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
    const responderHeroOnTurn = await readHeroParts(responderPage);
    expect(responderHeroOnTurn).toEqual(responderHeroBeforeTurn);
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
    await expect(revealedOpponent.locator(":scope > .seat-stack-line > .seat-stack")).toBeHidden();
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
    const settlementGeometry = await winnerPage.evaluate(() => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left:box.left, right:box.right, top:box.top, bottom:box.bottom };
      };
      const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const label = rect(document.querySelector(".showdown-win-label")!);
      const protectedCards = [
        ...document.querySelectorAll(".board-cards .playing-card, .seat:not(.folded) .seat-cards .playing-card")
      ].map(rect);
      return {
        label,
        viewport:{ width:innerWidth, height:innerHeight },
        cardOverlaps:protectedCards.filter((card) => overlaps(label, card)).length
      };
    });
    expect(settlementGeometry.cardOverlaps).toBe(0);
    expect(settlementGeometry.label.left).toBeGreaterThanOrEqual(0);
    expect(settlementGeometry.label.right).toBeLessThanOrEqual(settlementGeometry.viewport.width);
    expect(settlementGeometry.label.bottom).toBeLessThanOrEqual(settlementGeometry.viewport.height);
    await winnerPage.screenshot({ path:testInfo.outputPath("showdown-award-390x660.png") });
  } finally {
    await guestContext.close();
  }
});
