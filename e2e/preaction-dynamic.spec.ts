import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function register(context: BrowserContext, origin: string, prefix: string, nickname: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data: {
      email: `${prefix}-${stamp}@local.test`,
      password: "test-pass-123",
      nickname: `${nickname}${stamp.slice(-4)}`,
    },
  });
  expect(response.ok()).toBe(true);
  return `${nickname}${stamp.slice(-4)}`;
}

async function currentActor(pages: Page[]) {
  await expect.poll(async () => {
    const counts = await Promise.all(pages.map((page) => page.locator(".action-dock.my-turn").count()));
    return counts.filter(Boolean).length;
  }).toBe(1);
  const counts = await Promise.all(pages.map((page) => page.locator(".action-dock.my-turn").count()));
  return pages[counts.findIndex(Boolean)];
}

async function raiseWithLastPreset(page: Page) {
  await page.locator(".action.raise").dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0 });
  await expect(page.locator(".raise-panel")).toBeVisible();
  await page.locator(".action-arc button").last().click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
}

function queuedCall(page: Page) {
  return page.locator(".action-dock.waiting-turn .preaction-buttons button").last();
}

test("三人局预操作随上游行动更新并只按选定金额自动跟注", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const origin = "http://127.0.0.1:5173";
  await page.setViewportSize({ width: 390, height: 660 });
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 390, height: 660 } }),
    browser.newContext({ viewport: { width: 390, height: 660 } }),
  ]);
  const pages = [page, await contexts[0].newPage(), await contexts[1].newPage()];

  try {
    const hostNickname = await register(page.context(), origin, "pre-host", "预操作房主");
    await register(contexts[0], origin, "pre-one", "预操作甲");
    await register(contexts[1], origin, "pre-two", "预操作乙");
    const created = await page.context().request.post(`${origin}/api/rooms`, {
      data: { durationMinutes: 30, capacity: 3, startingStack: 200, smallBlind: 1, bigBlind: 2 },
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json() as { code: string };

    for (const playerPage of pages) {
      await playerPage.goto("/");
      const room = playerPage.locator(".public-room-list article", { hasText: hostNickname });
      await room.getByRole("button", { name: /加入/ }).click();
      await expect(playerPage.locator(".waiting-room")).toBeVisible();
      await playerPage.locator(".waiting-table-seat.empty").first().click();
    }
    await page.getByRole("button", { name: /开始牌局/ }).click();
    await Promise.all(pages.map((playerPage) => expect(playerPage.locator(".fresh-table")).toBeVisible()));

    const firstActor = await currentActor(pages);
    await expect(firstActor.locator("body")).not.toContainText("自动让牌");
    for (const waitingPage of pages.filter((candidate) => candidate !== firstActor)) {
      await expect(waitingPage.locator(".preaction-buttons button").first()).toHaveAccessibleName("让或弃");
      await expect(waitingPage.locator(".preaction-buttons button").last()).toHaveAccessibleName(/跟注/);
      await expect(waitingPage.locator(".preaction-buttons")).not.toContainText("自动让牌");
    }
    await raiseWithLastPreset(firstActor);
    const secondActor = await currentActor(pages);
    const downstream = pages.find((candidate) => candidate !== firstActor && candidate !== secondActor)!;

    const downstreamCall = queuedCall(downstream);
    await expect(downstreamCall).toBeEnabled();
    const oldCallLabel = await downstreamCall.getAttribute("aria-label");
    await downstreamCall.click();
    await expect(downstreamCall).toHaveAttribute("aria-pressed", "true");
    await downstream.screenshot({ path: testInfo.outputPath("queued-old-call-390x660.png") });

    await raiseWithLastPreset(secondActor);
    await expect(downstream.locator(".action-dock.my-turn")).toBeVisible();
    await expect(downstream.locator(".action.call")).toBeVisible();
    await expect(downstream.locator(".action-submitting")).toHaveCount(0);
    const newCallLabel = (await downstream.locator(".action.call").innerText()).replace(/\s+/g, " ").trim();
    expect(newCallLabel).not.toContain(oldCallLabel!.match(/[\d,]+/)![0]);

    const readActionGeometry = () => downstream.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const style = getComputedStyle(document.querySelector<HTMLElement>(selector)!);
        return { left:rect.left, top:rect.top, width:rect.width, height:rect.height, x:rect.left + rect.width / 2, y:rect.top + rect.height / 2, border:style.border, shadow:style.boxShadow };
      };
      return {
        hero:box(".hero-seat .avatar-ring"),
        fold:box(".action-buttons.with-raise .action.fold"),
        raise:box(".action-buttons.with-raise .action.raise"),
        right:box(".action-buttons.with-raise .action.call, .action-buttons.with-raise .action.check, .action-buttons.with-raise .action.allin"),
      };
    });
    const beforeHover = await readActionGeometry();
    expect(Math.abs(beforeHover.fold.width - beforeHover.right.width)).toBeLessThanOrEqual(.5);
    expect(Math.abs(beforeHover.fold.height - beforeHover.right.height)).toBeLessThanOrEqual(.5);
    expect(Math.abs(beforeHover.fold.y - beforeHover.right.y)).toBeLessThanOrEqual(.5);
    expect(Math.abs((beforeHover.fold.x + beforeHover.right.x) / 2 - beforeHover.hero.x)).toBeLessThanOrEqual(.5);
    expect(Math.abs(beforeHover.hero.x - beforeHover.fold.x - (beforeHover.right.x - beforeHover.hero.x))).toBeLessThanOrEqual(.5);
    expect(beforeHover.fold.border).toBe(beforeHover.right.border);
    expect(beforeHover.fold.shadow).toBe(beforeHover.right.shadow);

    await downstream.locator(".action.call").hover();
    const afterHover = await readActionGeometry();
    for (const key of ["fold", "raise", "right"] as const) {
      expect(Math.abs(afterHover[key].left - beforeHover[key].left)).toBeLessThanOrEqual(.5);
      expect(Math.abs(afterHover[key].top - beforeHover[key].top)).toBeLessThanOrEqual(.5);
      expect(Math.abs(afterHover[key].width - beforeHover[key].width)).toBeLessThanOrEqual(.5);
      expect(Math.abs(afterHover[key].height - beforeHover[key].height)).toBeLessThanOrEqual(.5);
    }
    await downstream.screenshot({ path: testInfo.outputPath("upstream-raise-cancels-old-call-390x660.png") });

    const firstActorSeatId = await firstActor.locator(".hero-seat").getAttribute("data-seat-id");
    expect(firstActorSeatId).toBeTruthy();
    const unchangedCall = queuedCall(firstActor);
    await expect(unchangedCall).toBeEnabled();
    const selectedLabel = await unchangedCall.getAttribute("aria-label");
    await unchangedCall.click();
    await expect(unchangedCall).toHaveAttribute("aria-pressed", "true");

    const downstreamAction = downstream.locator(".action.call");
    await expect(downstreamAction).toBeEnabled();
    await downstreamAction.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0 });
    await expect.poll(async () => {
      const response = await firstActor.context().request.get(`${origin}/api/rooms/${code}`);
      const body = await response.json() as { room: { game: { history: Array<{ type: string; seatId?: string; detail: string }> } } };
      return body.room.game.history.some((record) => record.type === "call" && record.seatId === firstActorSeatId);
    }).toBe(true);

    const stateResponse = await firstActor.context().request.get(`${origin}/api/rooms/${code}`);
    const state = await stateResponse.json() as { room: { game: { history: Array<{ type: string; seatId?: string; detail: string }> } } };
    const automaticCall = state.room.game.history.find((record) => record.type === "call" && record.seatId === firstActorSeatId);
    expect(automaticCall?.detail).toContain(selectedLabel!.match(/[\d,]+/)![0].replaceAll(",", ""));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
