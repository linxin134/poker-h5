import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:5173";

async function register(context: BrowserContext, prefix: string, nickname: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data:{ email:`${prefix}-${stamp}@local.test`, password:"test-pass-123", nickname }
  });
  expect(response.ok()).toBe(true);
}

async function openTrayAndSendExpression(page: Page) {
  await page.getByRole("button", { name:"发送互动表情" }).click();
  await expect(page.getByRole("dialog", { name:"互动表情" })).toBeVisible();
  await page.locator(".emoji-grid button").first().click();
}

async function expectCentredOverlay(page: Page, selector: string, avatarSelector?: string) {
  await expect(page.locator(selector)).toBeVisible();
  const geometry = await page.evaluate(({ overlaySelector, targetSelector }) => {
    const overlay = document.querySelector<HTMLElement>(overlaySelector)!.getBoundingClientRect();
    const overlayElement = document.querySelector<HTMLElement>(overlaySelector)!;
    const targetElement = targetSelector ? document.querySelector<HTMLElement>(targetSelector)! : overlayElement.parentElement!;
    const target = targetElement.getBoundingClientRect();
    return {
      deltaX:Math.abs(overlay.left + overlay.width / 2 - (target.left + target.width / 2)),
      deltaY:Math.abs(overlay.top + overlay.height / 2 - (target.top + target.height / 2))
    };
  }, { overlaySelector:selector, targetSelector:avatarSelector ?? "" });
  if (geometry.deltaX > 1 || geometry.deltaY > 1) throw new Error(`overlay not centred: ${JSON.stringify(geometry)}`);
}

test("三人同步看到发送者头像中心的普通表情，三秒消失且互动仍定向飞行", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "390x660 multiplayer expression contract");
  test.setTimeout(120_000);
  await page.setViewportSize({ width:390, height:660 });
  const contexts = [page.context(), await browser.newContext({ viewport:{ width:390, height:660 } }), await browser.newContext({ viewport:{ width:390, height:660 } })];
  const pages = [page, await contexts[1].newPage(), await contexts[2].newPage()];
  try {
    const hostNickname = `表情房主${Date.now().toString(36).slice(-4)}`;
    await register(contexts[0], "expression-host", hostNickname);
    await register(contexts[1], "expression-one", "表情甲");
    await register(contexts[2], "expression-two", "表情乙");
    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    const { code } = await created.json() as { code:string };
    for (let index = 1; index < contexts.length; index += 1) {
      expect((await contexts[index].request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    }
    for (let index = 0; index < pages.length; index += 1) {
      await pages[index].goto("/");
      await pages[index].locator(".public-room-list article", { hasText:hostNickname }).getByRole("button", { name:/加入/ }).click();
      await expect(pages[index].locator(".waiting-room")).toBeVisible();
      await pages[index].locator(".waiting-table-seat.empty").first().click();
    }
    await expect.poll(async () => page.locator(".waiting-table-seat.occupied").count()).toBe(3);
    const senderPosition = await page.locator(".waiting-table-seat.mine").evaluate((element) => {
      const seats = [...document.querySelectorAll<HTMLElement>(".waiting-table-seat")];
      return seats.indexOf(element as HTMLElement);
    });
    const senderSeatId = `seat-${senderPosition}`;
    const before = await page.locator(".waiting-table-seat.mine").boundingBox();
    await openTrayAndSendExpression(page);
    for (const client of pages) {
      const selector = `.waiting-emoji-overlay[data-emoji-sender="${senderSeatId}"]`;
      await expectCentredOverlay(client, selector, `.waiting-table-seat.occupied:has(.waiting-emoji-overlay[data-emoji-sender="${senderSeatId}"])>span`);
    }
    const after = await page.locator(".waiting-table-seat.mine").boundingBox();
    expect(after).toEqual(before);
    await expect(page.locator(".pixi-effects")).toHaveAttribute("data-active-effect-count", "0");
    await page.screenshot({ path:"qa-expression-results/waiting-expression-avatar-overlay-390x660.png" });
    await expect(page.locator(`.waiting-emoji-overlay[data-emoji-sender="${senderSeatId}"]`)).toBeHidden({ timeout:4_500 });

    await page.getByRole("button", { name:/开始牌局/ }).click();
    await Promise.all(pages.map((client) => expect(client.locator(".fresh-table")).toBeVisible()));
    await openTrayAndSendExpression(page);
    for (const client of pages) {
      await expectCentredOverlay(client, `.seat-emoji-overlay[data-emoji-sender="${senderSeatId}"]`, `.seat[data-seat-id="${senderSeatId}"] .avatar-ring`);
      await expect(client.locator(".pixi-effects")).toHaveAttribute("data-active-effect-count", "0");
    }
    await page.screenshot({ path:"qa-expression-results/table-expression-avatar-overlay-390x660.png" });
    await expect(page.locator(`.seat-emoji-overlay[data-emoji-sender="${senderSeatId}"]`)).toBeHidden({ timeout:4_500 });

    const target = page.locator(".opponent-seat .interactable-avatar").first();
    const targetSeatId = await target.getAttribute("data-interaction-target");
    await target.click();
    await page.getByRole("button", { name:"送花" }).click();
    await expect(page.locator(".pixi-effects")).toHaveAttribute("data-active-effects", new RegExp(`${senderSeatId}>${targetSeatId}`));
    await page.screenshot({ path:"qa-expression-results/interaction-still-targeted-flight-390x660.png" });
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
