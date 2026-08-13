import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function register(context: BrowserContext, origin: string, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data:{ email:`${prefix}-${stamp}@local.test`, password:"test-pass-123", nickname:`弧线${stamp.slice(-4)}` }
  });
  expect(response.ok()).toBe(true);
  return `弧线${stamp.slice(-4)}`;
}

const overlaps = (a:{ left:number; right:number; top:number; bottom:number }, b:{ left:number; right:number; top:number; bottom:number }) =>
  !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

test("五枚快捷加注共圆且预操作双行文字清晰", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  const origin = "http://127.0.0.1:5173";
  await page.setViewportSize({ width:390, height:660 });
  const guestContext = await browser.newContext({ viewport:{ width:390, height:660 } });
  const guestPage = await guestContext.newPage();
  try {
    const hostNickname = await register(page.context(), origin, "arc-host");
    await register(guestContext, origin, "arc-guest");
    const created = await page.context().request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    expect(created.ok()).toBe(true);

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

    const actorPage = await page.locator(".action-dock.my-turn").count() ? page : guestPage;
    const waitingPage = actorPage === page ? guestPage : page;
    await expect(actorPage.locator(".action-arc button")).toHaveCount(5);

    const arc = await actorPage.locator(".action-arc button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2, left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom };
    }));
    const crown = arc[2];
    expect(arc[0].x + arc[4].x, JSON.stringify(arc)).toBeCloseTo(2 * crown.x, 1);
    expect(arc[1].x + arc[3].x).toBeCloseTo(2 * crown.x, 1);
    expect(arc[0].y).toBeCloseTo(arc[4].y, 1);
    expect(arc[1].y).toBeCloseTo(arc[3].y, 1);
    expect(crown.y).toBeLessThan(arc[1].y);
    expect(arc[1].y).toBeLessThan(arc[0].y);

    // Fit the circle through the crown and right endpoint, then require every
    // centre to share that radius. This rejects a hand-tuned shallow V.
    const dx = arc[4].x - crown.x;
    const dy = arc[4].y - crown.y;
    const radius = (dx * dx + dy * dy) / (2 * dy);
    const circleY = crown.y + radius;
    const distances = arc.map((point) => Math.hypot(point.x - crown.x, point.y - circleY));
    expect(radius).toBeGreaterThanOrEqual(98);
    expect(radius).toBeLessThanOrEqual(102);
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThanOrEqual(.35);

    const protectedRects = await actorPage.evaluate(() => {
      const union = (selector:string) => {
        const boxes = [...document.querySelectorAll<HTMLElement>(selector)].map((element) => element.getBoundingClientRect());
        return { left:Math.min(...boxes.map((box) => box.left)), right:Math.max(...boxes.map((box) => box.right)), top:Math.min(...boxes.map((box) => box.top)), bottom:Math.max(...boxes.map((box) => box.bottom)) };
      };
      return {
        board:union(".board-cards > *"),
        primary:union(".action-buttons .action"),
        hero:union(".hero-seat > .avatar-ring,.hero-seat > .seat-cards,.hero-seat > .seat-hand-rank,.hero-seat .seat-stack")
      };
    });
    for (const circle of arc) {
      expect(overlaps(circle, protectedRects.board)).toBe(false);
      expect(overlaps(circle, protectedRects.primary)).toBe(false);
      expect(overlaps(circle, protectedRects.hero)).toBe(false);
    }
    await actorPage.screenshot({ path:testInfo.outputPath("natural-five-preset-arc-390x660.png") });

    const preactions = waitingPage.locator(".preaction-buttons button");
    await expect(preactions).toHaveCount(2);
    const typography = await preactions.evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const amount = button.querySelector<HTMLElement>("b");
      const label = button.querySelector<HTMLElement>("span");
      return {
        rect:{ left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height },
        font:Number.parseFloat(style.fontSize), opacity:Number.parseFloat(style.opacity),
        amountFont:amount ? Number.parseFloat(getComputedStyle(amount).fontSize) : null,
        labelFont:label ? Number.parseFloat(getComputedStyle(label).fontSize) : null,
      };
    }));
    expect(typography[0].font).toBeGreaterThanOrEqual(11.5);
    expect(typography[1].amountFont === null || typography[1].amountFont >= 13).toBe(true);
    expect(typography[1].labelFont).toBeGreaterThanOrEqual(10.5);
    expect(typography.every((entry) => entry.opacity === 1)).toBe(true);
    expect(typography.every((entry) => Math.abs(entry.rect.width - entry.rect.height) <= .5)).toBe(true);

    const heroParts = await waitingPage.locator(".hero-seat").evaluate((seat) => [...seat.querySelectorAll<HTMLElement>(".avatar-ring,.seat-cards,.seat-hand-rank,.seat-stack")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom };
    }));
    for (const button of typography) for (const heroPart of heroParts) expect(overlaps(button.rect, heroPart)).toBe(false);
    await waitingPage.screenshot({ path:testInfo.outputPath("readable-preactions-390x660.png") });
  } finally {
    await guestContext.close();
  }
});
