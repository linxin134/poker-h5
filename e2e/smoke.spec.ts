import { expect, test } from "@playwright/test";

test("三名玩家可以加入、选座、行动并自动续手", async ({ page, browser }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const nickname = `房主${Date.now().toString(36).slice(-6)}`;
  const guestOne = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const guestTwo = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lateGuest = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const guestOnePage = await guestOne.newPage();
  const guestTwoPage = await guestTwo.newPage();
  const lateGuestPage = await lateGuest.newPage();

  try {
    await page.context().request.post("/api/auth/register", { data: { email: `host-${stamp}@local.test`, password: "test-pass-123", nickname } });
    await guestOne.request.post("http://127.0.0.1:5173/api/auth/register", { data: { email: `g1-${stamp}@local.test`, password: "test-pass-123", nickname: `薄荷${testInfo.project.name}` } });
    await guestTwo.request.post("http://127.0.0.1:5173/api/auth/register", { data: { email: `g2-${stamp}@local.test`, password: "test-pass-123", nickname: `海盐${testInfo.project.name}` } });
    await lateGuest.request.post("http://127.0.0.1:5173/api/auth/register", { data: { email: `late-${stamp}@local.test`, password: "test-pass-123", nickname: `中途${testInfo.project.name}` } });

    await page.goto("/");
    await page.getByRole("button", { name: "创建房间" }).click();
    await expect(page.getByText("请选择空位")).toBeVisible();
    await page.locator(".waiting-table-seat.empty").first().click();

    await Promise.all([guestOnePage.goto("http://127.0.0.1:5173/"), guestTwoPage.goto("http://127.0.0.1:5173/")]);
    const roomOne = guestOnePage.locator(".public-room-list article", { hasText: nickname });
    const roomTwo = guestTwoPage.locator(".public-room-list article", { hasText: nickname });
    await roomOne.getByRole("button", { name: /加入/ }).click();
    await roomTwo.getByRole("button", { name: /加入/ }).click();
    await guestOnePage.locator(".waiting-table-seat.empty").first().click();
    await guestTwoPage.locator(".waiting-table-seat.empty").first().click();

    await expect(page.getByRole("button", { name: /开始牌局/ })).toBeEnabled();
    await page.getByRole("button", { name: /开始牌局/ }).click();
    await expect(page.getByText(/第 1 手/)).toBeVisible();

    const pages = [page, guestOnePage, guestTwoPage];
    for (const playerPage of pages) {
      await expect(playerPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
      await expect(playerPage.locator(".seat .card-back")).toHaveCount(4);
    }

    await lateGuestPage.goto("http://127.0.0.1:5173/");
    const activeRoom = lateGuestPage.locator(".public-room-list article", { hasText: nickname });
    await expect(activeRoom.getByText(/进行中/)).toBeVisible();
    await activeRoom.getByRole("button", { name: /加入牌局/ }).click();
    await expect(lateGuestPage.getByText("选择一个空位，下一手参与")).toBeVisible();
    await lateGuestPage.locator(".late-seat-choice").first().click();
    await expect(lateGuestPage.getByText("已落座，下一手自动参与")).toBeVisible();

    for (let round = 0; round < 3; round += 1) {
      for (const playerPage of pages) {
        const fold = playerPage.getByRole("button", { name: /弃牌/ });
        if (await fold.isEnabled()) { await fold.click(); break; }
      }
      if (await page.locator(".hand-settlement").count()) break;
      await page.waitForTimeout(150);
    }

    await expect(page.locator(".hand-settlement")).toBeVisible();
    await expect(page.getByText(/第 2 手/)).toBeVisible({ timeout: 6_000 });
    await expect(lateGuestPage.getByText(/第 2 手/)).toBeVisible({ timeout: 6_000 });
    await expect(lateGuestPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
    await expect(lateGuestPage.locator(".seat .card-back")).toHaveCount(6);

    await guestOnePage.getByRole("button", { name: "战绩" }).click();
    await expect(guestOnePage.locator(".record-seats .record-cards i")).toHaveCount(6);
  } finally {
    await guestOne.close();
    await guestTwo.close();
    await lateGuest.close();
  }
});
