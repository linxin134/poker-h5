import { expect, test } from "@playwright/test";

test("三名玩家可以加入、选座、行动并自动续手", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
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
    const logoutChrome = await page.locator(".lobby-icon-button").evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderWidth: style.borderWidth, backgroundColor: style.backgroundColor, width: element.getBoundingClientRect().width };
    });
    expect(logoutChrome).toEqual({ borderWidth: "0px", backgroundColor: "rgba(0, 0, 0, 0)", width: 39 });
    await page.screenshot({ path: testInfo.outputPath("mobile-lobby.png") });
    await page.getByRole("button", { name: "创建房间" }).click();
    const createScrollChrome = await page.locator(".wpk-create-room").evaluate((element) => {
      const style = getComputedStyle(element);
      const content = element.querySelector<HTMLElement>(".wpk-room-config")!;
      const sheet = element as HTMLElement;
      return { overflow: style.overflow, gutter: sheet.offsetWidth - sheet.clientWidth, contentScrollbar: getComputedStyle(content).scrollbarWidth };
    });
    expect(createScrollChrome).toEqual({ overflow: "hidden", gutter: 0, contentScrollbar: "none" });
    await expect(page.locator(".public-room-note")).toHaveCount(0);
    await expect(page.locator(".config-card")).toContainText("1 / 2");
    await expect(page.locator(".config-card")).toContainText("200 (100BB)");
    await expect(page.locator(".config-card")).toContainText("8 人");
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
    await expect(page.getByRole("button", { name: "发送互动表情" })).toBeVisible();
    await page.getByRole("button", { name: "发送互动表情" }).click();
    await expect(page.locator(".interaction-popover")).toBeVisible();
    await page.locator(".popover-close").click();
    await page.getByRole("button", { name: "牌桌功能" }).click();
    await expect(page.getByRole("button", { name: "规则说明" })).toBeVisible();
    await expect(page.getByRole("button", { name: "桌面设置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "解散房间" })).toBeVisible();
    await expect(page.getByRole("button", { name: "站起旁观" })).toBeVisible();
    await expect(page.locator(".wpk-function-menu .ui-icon")).toHaveCount(8);
    await page.screenshot({ path: testInfo.outputPath("mobile-menu.png") });
    await page.getByRole("button", { name: "站起旁观" }).click();
    await expect(page.locator(".waiting-table-seat.occupied")).toHaveCount(0);
    await page.locator(".drawer-shade").click({ position: { x: 380, y: 400 } });
    await page.locator(".waiting-table-seat.empty").first().click();
    await expect(page.locator(".waiting-table-seat.occupied")).toHaveCount(1);
    await page.locator(".waiting-bottom-tools").getByRole("button", { name: "聊天" }).click();
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
      await expect(playerPage.locator(".board-cards .card-back")).toHaveCount(5);
      await expect(playerPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
      await expect(playerPage.locator(".seat .card-back")).toHaveCount(4);
    }

    await expect(guestTwoPage.locator(".wpk-table-bar")).toBeVisible();
    await expect(guestTwoPage.locator(".board-room-countdown")).toHaveText(/\d{2}:\d{2}/);
    await expect(guestTwoPage.getByRole("button", { name: "计分" })).toBeVisible();
    await expect(guestTwoPage.getByRole("button", { name: "聊天" })).toBeVisible();
    await expect(guestTwoPage.locator(".table-tools .ui-icon")).toHaveCount(2);
    await expect(guestTwoPage.locator(".table-bottom-tools .ui-icon")).toHaveCount(2);
    await expect(guestTwoPage.locator(".round-tool .ui-icon")).toHaveCount(1);
    const tableGeometry = await guestTwoPage.evaluate(() => {
      const cardRects = [...document.querySelectorAll(".board-cards > .playing-card")].map((element) => element.getBoundingClientRect());
      const board = {
        left: Math.min(...cardRects.map((rect) => rect.left)),
        right: Math.max(...cardRects.map((rect) => rect.right)),
        top: Math.min(...cardRects.map((rect) => rect.top)),
        bottom: Math.max(...cardRects.map((rect) => rect.bottom))
      };
      const avatarRects = [...document.querySelectorAll(".seat .avatar-ring")].map((element) => element.getBoundingClientRect());
      const collisions = avatarRects.filter((avatar) => !(avatar.right <= board.left || avatar.left >= board.right || avatar.bottom <= board.top || avatar.top >= board.bottom)).length;
      const avatar = document.querySelector<HTMLElement>(".seat .avatar-ring")!;
      const avatarStyle = getComputedStyle(avatar);
      return { collisions, avatarSquare: Math.abs(avatar.offsetWidth - avatar.offsetHeight), avatarRadius: avatarStyle.borderRadius };
    });
    expect(tableGeometry).toEqual({ collisions: 0, avatarSquare: 0, avatarRadius: "12px" });
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-table.png") });

    await guestTwoPage.locator(".table-bottom-tools").getByRole("button", { name: "聊天" }).click();
    await expect(guestTwoPage.locator(".table-screen")).toHaveAttribute("data-drawer", "chat");
    await expect(guestTwoPage.locator(".game-drawer.tab-chat")).toBeVisible();
    await guestTwoPage.getByLabel("聊天内容").fill("这手有点意思");
    await guestTwoPage.getByRole("button", { name: "发送", exact: true }).click();
    await expect(guestTwoPage.locator(".wpk-chat-messages .mine p")).toHaveText("这手有点意思");
    await page.locator(".table-bottom-tools button").nth(1).click();
    await expect(page.locator(".wpk-chat-messages .other p")).toHaveText("这手有点意思");
    await page.locator(".game-drawer .panel-close").click();
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-chat.png") });
    await guestTwoPage.locator(".game-drawer .panel-close").click();

    await guestTwoPage.getByRole("button", { name: "补充记分牌" }).click();
    await expect(guestTwoPage.locator(".game-drawer.tab-topup")).not.toContainText("钻石");
    const topupBox = await guestTwoPage.locator(".game-drawer.tab-topup").boundingBox();
    const viewport = guestTwoPage.viewportSize();
    expect(topupBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.abs(topupBox!.x + topupBox!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
    expect(Math.abs(topupBox!.y + topupBox!.height / 2 - viewport!.height / 2)).toBeLessThan(2);
    await guestTwoPage.getByLabel("补充记分牌数量").fill("4000");
    await guestTwoPage.getByRole("button", { name: "带入", exact: true }).click();
    await expect(guestTwoPage.getByRole("button", { name: "已设置" })).toBeVisible();
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-topup.png") });
    await guestTwoPage.locator(".game-drawer .panel-close").click();

    await guestOnePage.reload();
    await expect(guestOnePage.getByText(/第 1 手/)).toBeVisible();
    await expect(guestOnePage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
    await guestOnePage.locator(".table-bottom-tools button").nth(1).click();
    await expect(guestOnePage.locator(".wpk-chat-messages .other p")).toHaveText("这手有点意思");
    await guestOnePage.locator(".game-drawer .panel-close").click();

    await guestTwoPage.getByRole("button", { name: /与 .* 互动/ }).first().click();
    await expect(guestTwoPage.locator(".player-interaction-card")).toBeVisible();
    const interactionBox = await guestTwoPage.locator(".player-interaction-card").boundingBox();
    expect(interactionBox).not.toBeNull();
    expect(interactionBox!.x).toBeGreaterThanOrEqual(8);
    expect(interactionBox!.x + interactionBox!.width).toBeLessThanOrEqual(guestTwoPage.viewportSize()!.width - 8);
    await expect(guestTwoPage.locator(".player-interaction-card>div>button")).toHaveCount(4);
    await guestTwoPage.getByRole("button", { name: "送花" }).click();
    await guestTwoPage.getByRole("button", { name: "发送互动表情" }).click();
    await expect(guestTwoPage.locator(".interaction-popover")).toBeVisible();
    await guestTwoPage.locator(".popover-close").click();

    await lateGuestPage.goto("http://127.0.0.1:5173/");
    const activeRoom = lateGuestPage.locator(".public-room-list article", { hasText: nickname });
    await expect(activeRoom.getByText(/进行中/)).toBeVisible();
    await activeRoom.getByRole("button", { name: /^加入 / }).click();
    await expect(lateGuestPage.getByText("选择空位落座，下一手发两张底牌")).toHaveCount(0);
    await page.getByRole("button", { name: "计分" }).click();
    await expect(page.locator(".wpk-spectators")).toContainText(`中途${testInfo.project.name}`);
    const rankingDeltas = (await page.locator(".wpk-ranking-list .pixel-chip b").allTextContents()).map((value) => Number(value.replaceAll(",", "")));
    expect(rankingDeltas).toEqual([...rankingDeltas].sort((a, b) => b - a));
    await page.locator(".game-drawer .panel-close").click();

    for (let actionIndex = 0; actionIndex < 12 && await page.locator(".board-cards .playing-card:not(.card-back)").count() < 3; actionIndex += 1) {
      for (const playerPage of pages) {
        const passiveAction = playerPage.locator(".action.neutral");
        if (await passiveAction.count() > 0 && await passiveAction.isEnabled()) {
          await passiveAction.click();
          break;
        }
      }
      await page.waitForTimeout(120);
    }
    await expect(page.locator(".board-cards .playing-card:not(.card-back)")).toHaveCount(3);
    await expect(lateGuestPage.locator(".board-cards .playing-card:not(.card-back)")).toHaveCount(3);
    await expect(lateGuestPage.locator(".board-cards .card-back")).toHaveCount(2);
    await expect(page.locator(".pot-badge")).toContainText("总底池");
    await expect(page.locator(".pot-badge i")).toBeVisible();
    const seatHierarchy = await page.locator(".hero-seat").evaluate((seat) => {
      const id = seat.querySelector(".seat-info b")!.getBoundingClientRect();
      const avatar = seat.querySelector(".avatar-ring")!.getBoundingClientRect();
      const stack = seat.querySelector(".seat-info span")!.getBoundingClientRect();
      const cards = seat.querySelector(".seat-cards")!.getBoundingClientRect();
      return { idBottom:id.bottom, avatarTop:avatar.top, avatarBottom:avatar.bottom, stackTop:stack.top, stackBottom:stack.bottom, cardsTop:cards.top };
    });
    expect(seatHierarchy.idBottom).toBeLessThanOrEqual(seatHierarchy.avatarTop + 2);
    expect(seatHierarchy.stackTop).toBeGreaterThanOrEqual(seatHierarchy.avatarBottom);
    expect(seatHierarchy.cardsTop).toBeGreaterThanOrEqual(seatHierarchy.stackBottom);
    await lateGuestPage.screenshot({ path: testInfo.outputPath("mobile-spectator-flop.png") });

    for (const playerPage of pages) {
      const raise = playerPage.locator(".action.raise");
      if (await raise.count() > 0 && await raise.isEnabled()) {
        const actionGap = await playerPage.evaluate(() => {
          const hero = document.querySelector(".hero-seat")!.getBoundingClientRect();
          const dock = document.querySelector(".action-dock.my-turn")!.getBoundingClientRect();
          return dock.top - hero.bottom;
        });
        expect(actionGap).toBeGreaterThanOrEqual(8);
        await raise.click();
        await expect(playerPage.locator(".raise-panel")).toBeVisible();
        await expect(playerPage.locator(".raise-panel .quick-raises button")).toHaveCount(4);
        await expect(playerPage.locator(".turn-progress")).toBeVisible();
        await playerPage.screenshot({ path: testInfo.outputPath("mobile-raise.png") });
        await raise.click();
        break;
      }
    }

    await lateGuestPage.locator(".late-seat-choice").first().click();
    await expect(lateGuestPage.locator(".pending-seat.hero-seat")).toBeVisible();

    let revealedFoldedCard = false;
    for (let round = 0; round < 3; round += 1) {
      for (const playerPage of pages) {
        const fold = playerPage.locator(".action.fold");
        if (await fold.count() > 0 && await fold.isEnabled()) {
          await fold.click();
          if (!revealedFoldedCard) {
            const reveal = playerPage.getByRole("button", { name:"公开第 1 张底牌" });
            await expect(reveal).toBeVisible();
            await reveal.click();
            const observer = pages.find((candidate) => candidate !== playerPage)!;
            await expect.poll(() => observer.locator(".seat.folded .playing-card:not(.card-back)").count()).toBe(1);
            await expect(observer.locator(".seat.folded .card-back")).toHaveCount(1);
            revealedFoldedCard = true;
          }
          break;
        }
      }
      if (await page.locator(".hand-settlement").count()) break;
      await page.waitForTimeout(150);
    }

    await expect(page.locator(".hand-settlement")).toBeVisible();
    await expect(page.locator(".pot-award-layer .pot-award-coin")).toHaveCount(9);
    await expect(page.getByText(/第 2 手/)).toBeVisible({ timeout: 8_000 });
    await expect(lateGuestPage.getByText(/第 2 手/)).toBeVisible({ timeout: 8_000 });
    await expect(guestTwoPage.locator(".hero-seat .seat-info span")).toContainText("3,");
    await expect(lateGuestPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
    await expect(lateGuestPage.locator(".seat .card-back")).toHaveCount(6);
    await guestTwoPage.getByRole("button", { name: "补充记分牌" }).click();
    await expect(guestTwoPage.getByRole("button", { name: "带入", exact: true })).toBeVisible();
    await guestTwoPage.locator(".game-drawer .panel-close").click();

    const showdownPlayers = [...pages, lateGuestPage];
    for (let actionIndex = 0; actionIndex < 40; actionIndex += 1) {
      let acted = false;
      for (const playerPage of showdownPlayers) {
        const passiveAction = playerPage.locator(".action.neutral");
        if (await passiveAction.count() > 0 && await passiveAction.isEnabled()) {
          await passiveAction.click();
          acted = true;
          break;
        }
      }
      if (await page.locator(".table-screen").getAttribute("data-result") === "showdown") break;
      await page.waitForTimeout(acted ? 140 : 80);
    }
    await expect(page.locator(".table-screen")).toHaveAttribute("data-result", "showdown");
    await expect(page.locator(".seat .playing-card:not(.card-back)")).toHaveCount(8);
    await expect(page.locator(".hand-settlement")).toBeVisible();

    await guestOnePage.getByRole("button", { name: "牌桌功能" }).click();
    await guestOnePage.locator(".wpk-function-menu").getByRole("button", { name: /牌局回顾/ }).click();
    await expect(guestOnePage.locator(".game-drawer.tab-history")).toHaveClass(/drawer-left/);
    const historyDrawer = await guestOnePage.locator(".game-drawer.tab-history").boundingBox();
    const historyTable = await guestOnePage.locator(".table-screen").boundingBox();
    expect(historyDrawer).not.toBeNull();
    expect(historyTable).not.toBeNull();
    expect(historyDrawer!.x).toBeCloseTo(historyTable!.x, 0);
    expect(historyDrawer!.width / historyTable!.width).toBeCloseTo(.84, 1);
    await expect(guestOnePage.locator(".history-pager")).toBeVisible();
    await expect(guestOnePage.locator(".hand-record-card")).toHaveCount(1);
    await expect(guestOnePage.locator(".record-seats .record-card-back")).toHaveCount(0);
    await expect(guestOnePage.locator(".record-player small").filter({ hasText:/高牌|一对|两对|三条|顺子|同花|葫芦|四条|同花顺|皇家同花顺/ })).toHaveCount(4);
    await expect(guestOnePage.locator(".record-seats>div.winner")).toHaveCount(0);
    await guestOnePage.getByRole("button", { name:"更早一手" }).click();
    await expect(guestOnePage.locator(".record-seats .record-cards i")).toHaveCount(6);
    await expect(guestOnePage.locator(".record-seats .record-card-back")).toHaveCount(5);

    await page.locator(".table-menu-trigger").click();
    await page.getByRole("button", { name: "解散房间" }).click();
    await expect(page.getByLabel("房间列表")).toBeVisible();
  } finally {
    await guestOne.close();
    await guestTwo.close();
    await lateGuest.close();
  }
});
