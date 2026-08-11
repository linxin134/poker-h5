import { expect, test } from "@playwright/test";

test("三名玩家可以加入、选座、行动并自动续手", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
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
    await page.screenshot({ path: testInfo.outputPath("mobile-lobby.png") });
    await page.getByRole("button", { name: "创建房间" }).click();
    await page.getByLabel("盲注级别").fill("2");
    await page.getByRole("button", { name: "200BB" }).click();
    await page.screenshot({ path: testInfo.outputPath("mobile-create-room.png") });
    await page.getByRole("button", { name: "立即开局" }).click();
    await expect(page.getByText("请选择空位")).toBeVisible();
    await expect(page.locator(".room-rules")).toContainText("5 / 10");
    await page.locator(".waiting-table-seat.empty").first().click();
    await expect(page.getByRole("navigation", { name: "牌桌功能栏" })).toBeVisible();
    await expect(page.getByRole("button", { name: "牌局回顾" })).toBeVisible();
    await expect(page.getByRole("button", { name: "补充记分牌" })).toBeVisible();
    await page.getByRole("button", { name: "牌桌功能" }).click();
    await expect(page.getByRole("button", { name: "规则说明" })).toBeVisible();
    await expect(page.getByRole("button", { name: "桌面设置" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-menu.png") });
    await page.locator(".drawer-shade").click({ position: { x: 380, y: 400 } });
    await page.locator(".waiting-bottom-tools button", { hasText: "聊天" }).click();
    await expect(page.getByLabel("聊天内容")).toBeVisible();
    await page.locator(".game-drawer .panel-close").click();

    await Promise.all([guestOnePage.goto("http://127.0.0.1:5173/"), guestTwoPage.goto("http://127.0.0.1:5173/")]);
    const roomOne = guestOnePage.locator(".public-room-list article", { hasText: nickname });
    const roomTwo = guestTwoPage.locator(".public-room-list article", { hasText: nickname });
    await roomOne.getByRole("button", { name: /加入/ }).click();
    await roomTwo.getByRole("button", { name: /加入/ }).click();
    await guestOnePage.locator(".waiting-table-seat.empty").nth(1).click();
    await guestTwoPage.locator(".waiting-table-seat.empty").nth(2).click();

    await expect(page.getByRole("button", { name: /开始牌局/ })).toBeEnabled();
    await page.getByRole("button", { name: /开始牌局/ }).click();
    await expect(page.getByText(/第 1 手/)).toBeVisible();

    const pages = [page, guestOnePage, guestTwoPage];
    for (const playerPage of pages) {
      await expect(playerPage.locator(".board-cards > *")).toHaveCount(5);
      await expect(playerPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
      await expect(playerPage.locator(".seat .card-back")).toHaveCount(4);
    }

    await expect(guestTwoPage.locator(".wpk-table-bar")).toBeVisible();
    await expect(guestTwoPage.getByRole("button", { name: "计分" })).toBeVisible();
    await expect(guestTwoPage.getByRole("button", { name: "聊天" })).toBeVisible();
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-table.png") });

    await guestTwoPage.locator(".table-bottom-tools button", { hasText: "聊天" }).click();
    await expect(guestTwoPage.locator(".table-screen")).toHaveAttribute("data-drawer", "chat");
    await expect(guestTwoPage.locator(".game-drawer.tab-chat")).toBeVisible();
    await guestTwoPage.getByLabel("聊天内容").fill("这手有点意思");
    await guestTwoPage.getByRole("button", { name: "发送", exact: true }).click();
    await expect(guestTwoPage.locator(".wpk-chat-messages .mine p")).toHaveText("这手有点意思");
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-chat.png") });
    await guestTwoPage.locator(".game-drawer .panel-close").click();

    await guestTwoPage.getByRole("button", { name: "补充记分牌" }).click();
    await guestTwoPage.getByLabel("补充记分牌数量").fill("4000");
    await guestTwoPage.getByRole("button", { name: "带入", exact: true }).click();
    await expect(guestTwoPage.getByRole("button", { name: "已设置" })).toBeVisible();
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-topup.png") });
    await guestTwoPage.locator(".game-drawer .panel-close").click();

    await guestTwoPage.getByRole("button", { name: /与 .* 互动/ }).first().click();
    await expect(guestTwoPage.locator(".player-interaction-card")).toBeVisible();
    await guestTwoPage.getByRole("button", { name: "送花" }).click();
    await guestTwoPage.getByRole("button", { name: "发送互动表情" }).click();
    await expect(guestTwoPage.locator(".interaction-popover")).toBeVisible();
    await guestTwoPage.locator(".popover-close").click();

    for (const playerPage of pages) {
      const raise = playerPage.locator(".action.raise");
      if (await raise.count() > 0 && await raise.isEnabled()) {
        await raise.click();
        await expect(playerPage.locator(".raise-panel")).toBeVisible();
        await expect(playerPage.locator(".raise-panel .quick-raises button")).toHaveCount(4);
        await expect(playerPage.locator(".turn-progress")).toBeVisible();
        await playerPage.screenshot({ path: testInfo.outputPath("mobile-raise.png") });
        await raise.click();
        break;
      }
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
        const fold = playerPage.locator(".action.fold");
        if (await fold.count() > 0 && await fold.isEnabled()) { await fold.click(); break; }
      }
      if (await page.locator(".hand-settlement").count()) break;
      await page.waitForTimeout(150);
    }

    await expect(page.locator(".hand-settlement")).toBeVisible();
    await expect(page.getByText(/第 2 手/)).toBeVisible({ timeout: 6_000 });
    await expect(lateGuestPage.getByText(/第 2 手/)).toBeVisible({ timeout: 6_000 });
    await expect(guestTwoPage.locator(".hero-seat .seat-info span")).toContainText("3,");
    await expect(lateGuestPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
    await expect(lateGuestPage.locator(".seat .card-back")).toHaveCount(6);

    await guestOnePage.getByRole("button", { name: "牌桌功能" }).click();
    await guestOnePage.locator(".wpk-function-menu").getByRole("button", { name: /牌局回顾/ }).click();
    await expect(guestOnePage.locator(".record-seats .record-cards i")).toHaveCount(6);
  } finally {
    await guestOne.close();
    await guestTwo.close();
    await lateGuest.close();
  }
});
