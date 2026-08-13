import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:5173";

async function register(context: BrowserContext, prefix: string, nickname: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const uniqueNickname = `${nickname}${stamp.slice(-3)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data:{ email:`${prefix}-${stamp}@local.test`, password:"test-pass-123", nickname:uniqueNickname }
  });
  expect(response.ok()).toBe(true);
  return uniqueNickname;
}

test("点击对手头像锁定目标并把互动表情投向该头像", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "390x660 mobile interaction contract");
  test.setTimeout(120_000);
  await page.setViewportSize({ width:390, height:660 });
  const contexts = [page.context(), await browser.newContext({ viewport:{ width:390, height:660 } }), await browser.newContext({ viewport:{ width:390, height:660 } })];
  const pages = [page, await contexts[1].newPage(), await contexts[2].newPage()];
  try {
    const hostNickname = await register(contexts[0], "interaction-host", "互动房主");
    await register(contexts[1], "interaction-one", "互动甲");
    await register(contexts[2], "interaction-two", "互动乙");
    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    expect(created.ok()).toBe(true);

    for (const playerPage of pages) {
      await playerPage.goto("/");
      await playerPage.locator(".public-room-list article", { hasText:hostNickname }).getByRole("button", { name:/加入/ }).click();
      await expect(playerPage.locator(".waiting-room")).toBeVisible();
      await playerPage.locator(".waiting-table-seat.empty").first().click();
    }
    await page.getByRole("button", { name:/开始牌局/ }).click();
    await Promise.all(pages.map((playerPage) => expect(playerPage.locator(".fresh-table")).toBeVisible()));

    const senderSeatId = await page.locator(".hero-seat").getAttribute("data-seat-id");
    const opponents = page.locator(".opponent-seat .interactable-avatar");
    await expect(opponents).toHaveCount(2);
    await expect(page.locator(".hero-seat .interactable-avatar")).toHaveCount(0);

    const firstTarget = opponents.first();
    const secondTarget = opponents.nth(1);
    const firstTargetSeatId = await firstTarget.getAttribute("data-interaction-target");
    const secondTargetSeatId = await secondTarget.getAttribute("data-interaction-target");
    expect(senderSeatId).toBeTruthy();
    expect(firstTargetSeatId).toBeTruthy();
    expect(secondTargetSeatId).toBeTruthy();
    expect(firstTargetSeatId).not.toBe(senderSeatId);

    await firstTarget.click();
    await expect(page.locator(".player-interaction-card")).toHaveAttribute("data-target-seat-id", firstTargetSeatId!);
    await expect(firstTarget).toHaveAttribute("aria-expanded", "true");
    const panelBox = await page.locator(".player-interaction-card").boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(8);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(382);
    expect(panelBox!.y).toBeGreaterThanOrEqual(8);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(652);

    // A real pointer hit just outside the anchored popover must dismiss it.
    await page.mouse.click(4, 330);
    await expect(page.locator(".player-interaction-card")).toBeHidden();

    await secondTarget.click();
    await expect(page.locator(".player-interaction-card")).toHaveAttribute("data-target-seat-id", secondTargetSeatId!);
    await firstTarget.click();
    await expect(page.locator(".player-interaction-card")).toHaveAttribute("data-target-seat-id", firstTargetSeatId!);
    await page.screenshot({ path:testInfo.outputPath("opponent-interaction-picker-390x660.png") });

    const targetCenter = await firstTarget.evaluate((element) => {
      const target = element.getBoundingClientRect();
      const layer = document.querySelector<HTMLElement>(".pixi-effects")!.getBoundingClientRect();
      return { x:target.left + target.width / 2 - layer.left, y:target.top + target.height / 2 - layer.top };
    });
    await page.getByRole("button", { name:"送花" }).click();
    await expect(page.locator(".player-interaction-card")).toBeHidden();
    await expect(page.locator(".pixi-effects")).toHaveAttribute("data-active-effects", new RegExp(`${senderSeatId}>${firstTargetSeatId}`));
    await page.waitForTimeout(260);
    await page.screenshot({ path:testInfo.outputPath("opponent-emoji-flight-390x660.png") });
    await expect.poll(async () => page.locator(".pixi-effects").getAttribute("data-last-impact-seat-id"), { timeout:4_000 }).toBe(firstTargetSeatId);
    const impact = await page.locator(".pixi-effects").evaluate((element) => ({
      x:Number((element as HTMLElement).dataset.lastImpactX),
      y:Number((element as HTMLElement).dataset.lastImpactY),
      from:(element as HTMLElement).dataset.lastImpactFromSeatId
    }));
    expect(impact.from).toBe(senderSeatId);
    expect(impact.x).toBeCloseTo(targetCenter.x, 0);
    expect(impact.y).toBeCloseTo(targetCenter.y, 0);
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
