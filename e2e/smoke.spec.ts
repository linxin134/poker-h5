import { expect, test } from "@playwright/test";

test("三名玩家可以加入、选座、行动并自动续手", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  let nickname = `房主${Date.now().toString(36).slice(-6)}`;
  const guestOne = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const guestTwo = await browser.newContext({ viewport: { width: 390, height: 660 } });
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
    await page.getByRole("button", { name: "我的" }).click();
    await expect(page.getByRole("heading", { name: "我的" })).toBeVisible();
    nickname = `${nickname}新`;
    await page.getByLabel("昵称").fill(nickname);
    await page.getByRole("button", { name: "头像 6" }).click();
    await page.getByLabel("上传自定义头像").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    });
    await expect(page.locator(".profile-hero .game-avatar")).toHaveAttribute("style", /data:image\/jpeg;base64/);
    await page.getByRole("button", { name: "保存资料" }).click();
    await expect(page.getByRole("button", { name: "已保存" })).toBeVisible();
    await page.getByRole("button", { name: "历史战绩" }).click();
    await expect(page.getByText("还没有历史牌局")).toBeVisible();
    await page.locator(".profile-sheet-header").getByRole("button", { name: "返回" }).click();
    await expect(page.locator(".profile-chip")).toContainText(nickname);
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
    const mobileFeltTexture = await page.locator(".waiting-felt").evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(mobileFeltTexture.match(/radial-gradient/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    await expect(page.locator(".room-rules")).toContainText("5 / 10");
    await page.locator(".waiting-table-seat.empty").first().click();
    await expect(page.getByRole("navigation", { name: "牌桌功能栏" })).toBeVisible();
    await expect(page.getByRole("button", { name: "牌局回顾" })).toBeVisible();
    await expect(page.getByRole("button", { name: "补充记分牌" })).toBeVisible();
    await expect(page.getByRole("button", { name: "发送互动表情" })).toBeVisible();
    await page.getByRole("button", { name: "发送互动表情" }).click();
    await expect(page.locator(".interaction-popover")).toBeVisible();
    const emojiGeometry = await page.locator(".interaction-popover").evaluate((element) => {
      const panel = element.getBoundingClientRect();
      const table = document.querySelector(".waiting-room")!.getBoundingClientRect();
      return {
        left: panel.left - table.left,
        right: table.right - panel.right,
        bottom: table.bottom - panel.bottom,
        widthDelta: Math.abs(panel.width - table.width)
      };
    });
    expect(emojiGeometry.left).toBeCloseTo(8, 0);
    expect(emojiGeometry.right).toBeCloseTo(8, 0);
    expect(emojiGeometry.bottom).toBeGreaterThanOrEqual(0);
    expect(emojiGeometry.widthDelta).toBeCloseTo(16, 0);
    await expect(page.locator(".interaction-popover")).toHaveCSS("border-radius", "14px");
    await page.locator(".popover-close").click();
    await page.getByRole("button", { name: "牌桌功能" }).click();
    await expect(page.getByRole("button", { name: "规则说明" })).toBeVisible();
    await expect(page.getByRole("button", { name: "桌面设置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "解散房间" })).toBeVisible();
    await expect(page.getByRole("button", { name: "站起旁观" })).toBeVisible();
    await expect(page.locator(".wpk-function-menu .ui-icon")).toHaveCount(8);
    const menuGeometry = await page.evaluate(() => {
      const panel = document.querySelector(".game-drawer.drawer-menu")!.getBoundingClientRect();
      const table = document.querySelector(".waiting-room")!.getBoundingClientRect();
      return { left: panel.left - table.left, top: panel.top - table.top, right: table.right - panel.right, bottom: table.bottom - panel.bottom };
    });
    expect(menuGeometry.left).toBeGreaterThanOrEqual(0);
    expect(menuGeometry.top).toBeGreaterThanOrEqual(0);
    expect(menuGeometry.right).toBeGreaterThanOrEqual(0);
    expect(menuGeometry.bottom).toBeGreaterThanOrEqual(0);
    for (const panelName of ["规则说明", "桌面设置", "补充记分牌"]) {
      await page.locator(".wpk-function-menu").getByRole("button", { name: panelName }).click();
      const modalGeometry = await page.locator(".game-drawer.drawer-modal").evaluate((element) => {
        const panel = element.getBoundingClientRect();
        const table = document.querySelector(".waiting-room")!.getBoundingClientRect();
        return {
          centerX: Math.abs(panel.left + panel.width / 2 - (table.left + table.width / 2)),
          centerY: Math.abs(panel.top + panel.height / 2 - (table.top + table.height / 2)),
          inside: panel.left >= table.left && panel.right <= table.right && panel.top >= table.top && panel.bottom <= table.bottom
        };
      });
      expect(modalGeometry.centerX).toBeLessThan(2);
      expect(modalGeometry.centerY).toBeLessThan(2);
      expect(modalGeometry.inside).toBe(true);
      await expect(page.locator(".game-drawer.drawer-modal")).toHaveCSS("transform", "none");
      await page.getByRole("button", { name: "返回功能菜单" }).click();
    }
    await page.screenshot({ path: testInfo.outputPath("mobile-menu.png") });
    await page.getByRole("button", { name: "站起旁观" }).click();
    await expect(page.locator(".waiting-table-seat.occupied")).toHaveCount(0);
    await page.locator(".drawer-shade").click({ position: { x: 380, y: 400 } });
    const hostSeatChoice = page.locator(".waiting-table-seat.empty").nth(3);
    const hostSeatCenter = await hostSeatChoice.evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
    await hostSeatChoice.click();
    await expect(page.locator(".waiting-table-seat.occupied")).toHaveCount(1);
    const hostOccupiedGeometry = await page.locator(".waiting-table-seat.mine").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const stage = document.querySelector(".waiting-table-stage")!.getBoundingClientRect();
      return {
        center:{ x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 },
        anchor:{ x:stage.left + stage.width * .5, y:stage.top + stage.height * (1 - (14 * 2 / 3) / 100) }
      };
    });
    const hostOccupiedCenter = hostOccupiedGeometry.center;
    expect(Math.hypot(hostOccupiedCenter.x - hostOccupiedGeometry.anchor.x, hostOccupiedCenter.y - hostOccupiedGeometry.anchor.y)).toBeLessThanOrEqual(2);
    expect(Math.hypot(hostOccupiedCenter.x - hostSeatCenter.x, hostOccupiedCenter.y - hostSeatCenter.y)).toBeGreaterThan(50);
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
    for (const playerPage of [page, guestOnePage, guestTwoPage]) {
      const ownSeatAlignment = await playerPage.evaluate(() => {
        const stage = document.querySelector(".waiting-table-stage")!.getBoundingClientRect();
        const seat = document.querySelector(".waiting-table-seat.mine")!.getBoundingClientRect();
        return Math.hypot(seat.left + seat.width / 2 - (stage.left + stage.width * .5), seat.top + seat.height / 2 - (stage.top + stage.height * (1 - (14 * 2 / 3) / 100)));
      });
      expect(ownSeatAlignment).toBeLessThanOrEqual(2);
    }

    await expect(page.getByRole("button", { name: /开始牌局/ })).toBeEnabled();
    await page.getByRole("button", { name: /开始牌局/ }).click();
    await expect(page.getByText(/第 1 手/)).toBeVisible();

    const pages = [page, guestOnePage, guestTwoPage];
    const heroAvatarTops = await Promise.all(pages.map((playerPage) => playerPage.locator(".hero-seat .avatar-ring").evaluate((element) => element.getBoundingClientRect().top)));
    for (const playerPage of pages) {
      const heroAlignment = await playerPage.evaluate(() => {
        const stage = document.querySelector(".table-stage")!.getBoundingClientRect();
        const seat = document.querySelector(".hero-seat")!.getBoundingClientRect();
        return Math.hypot(seat.left + seat.width / 2 - (stage.left + stage.width * .5), seat.top + seat.height / 2 - (stage.top + stage.height * (1 - (14 * 2 / 3) / 100)));
      });
      expect(heroAlignment).toBeLessThanOrEqual(2);
      await expect(playerPage.locator(".board-cards > *")).toHaveCount(5);
      await expect(playerPage.locator(".board-cards .card-back")).toHaveCount(5);
      await expect(playerPage.locator(".seat .playing-card:not(.card-back)")).toHaveCount(2);
      await expect(playerPage.locator(".seat .card-back")).toHaveCount(4);
      await expect(playerPage.locator(".hero-seat .playing-card:not(.card-back) .card-corner-top i")).toHaveCount(2);
      for (const suit of await playerPage.locator(".hero-seat .playing-card:not(.card-back) .card-corner-top i").allTextContents()) {
        expect(suit).toMatch(/[♠♥♦♣]/);
      }
      const playerTextRendering = await playerPage.locator(".hero-seat .seat-info b").evaluate((element) => {
        const style = getComputedStyle(element);
        const seatMatrix = new DOMMatrixReadOnly(getComputedStyle(element.closest(".seat")!).transform);
        return { textShadow: style.textShadow, filter: style.filter, fontSize: style.fontSize, lineHeight: style.lineHeight, scaleX: seatMatrix.a, scaleY: seatMatrix.d };
      });
      expect(playerTextRendering).toEqual({ textShadow: "none", filter: "none", fontSize: "12px", lineHeight: "13.2px", scaleX: 1, scaleY: 1 });
    }
    const actingPage = (await Promise.all(pages.map(async (playerPage) => await playerPage.locator(".action-buttons").count() ? playerPage : null))).find(Boolean)!;
    await expect(actingPage.locator(".action-buttons small")).toHaveCount(0);
    await expect(actingPage.locator(".action-buttons")).not.toContainText(/FOLD|CHECK|CALL|BET SIZE|ALL IN/);
    const actionButtonBoxes = await actingPage.locator(".action-buttons .action").evaluateAll((buttons) => buttons.map((button) => { const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }));
    expect(Math.max(...actionButtonBoxes.map((box) => box.height))).toBeLessThanOrEqual(24);
    expect(Math.max(...actionButtonBoxes.map((box) => box.width))).toBeLessThanOrEqual(64);
    const preactionPage = pages.find((playerPage) => playerPage !== actingPage)!;
    await preactionPage.getByRole("button", { name: "自动弃牌" }).click();
    await expect(preactionPage.getByRole("button", { name: "自动弃牌" })).toHaveAttribute("aria-pressed", "true");
    await preactionPage.getByRole("button", { name: "自动弃牌" }).click();
    await expect(preactionPage.getByRole("button", { name: "自动弃牌" })).toHaveAttribute("aria-pressed", "false");
    await expect(preactionPage.getByRole("button", { name: "自动弃牌" })).toBeVisible();
    const preactionGeometry = await preactionPage.evaluate(() => {
      const dock = document.querySelector(".preaction-buttons")!.getBoundingClientRect();
      const candidates = [".hero-seat .avatar-ring", ".hero-seat .seat-cards", ".hero-seat .seat-bet", ".board-cards"]
        .map((selector) => ({ selector, rect: document.querySelector(selector)?.getBoundingClientRect() }))
        .filter((entry): entry is { selector: string; rect: DOMRect } => Boolean(entry.rect));
      const collisions = candidates.filter(({ rect }) => dock.left < rect.right && dock.right > rect.left && dock.top < rect.bottom && dock.bottom > rect.top).map(({ selector }) => selector);
      return { collisions, clipped: dock.left < 0 || dock.right > innerWidth || dock.top < 0 || dock.bottom > innerHeight };
    });
    expect(preactionGeometry).toEqual({ collisions: [], clipped: false });

    await expect(guestTwoPage.locator(".wpk-table-bar")).toBeVisible();
    await expect(guestTwoPage.locator(".board-room-countdown")).toHaveText(/\d{2}:\d{2}/);
    await expect(guestTwoPage.getByRole("button", { name: "计分" })).toBeVisible();
    await expect(guestTwoPage.getByRole("button", { name: "聊天" })).toBeVisible();
    await expect(guestTwoPage.locator(".table-tools .ui-icon")).toHaveCount(2);
    await expect(guestTwoPage.locator(".table-bottom-tools .ui-icon")).toHaveCount(2);
    await expect(guestTwoPage.locator(".round-tool .ui-icon")).toHaveCount(1);
    const edgeControlGeometry = await guestTwoPage.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      };
      return {
        menu: rect(".table-menu-trigger"),
        top: rect(".table-tools button"),
        bottom: rect(".table-bottom-tools button"),
        emoji: rect(".round-tool"),
        shield: rect(".table-shield")
      };
    });
    expect(edgeControlGeometry.menu.width).toBeCloseTo(40, 0);
    expect(edgeControlGeometry.menu.height).toBeCloseTo(40, 0);
    expect(edgeControlGeometry.top.width).toBeCloseTo(52, 0);
    expect(edgeControlGeometry.top.height).toBeCloseTo(52, 0);
    expect(edgeControlGeometry.bottom.width).toBeCloseTo(52, 0);
    expect(edgeControlGeometry.bottom.height).toBeCloseTo(52, 0);
    expect(edgeControlGeometry.emoji.width).toBeCloseTo(52, 0);
    expect(edgeControlGeometry.emoji.height).toBeCloseTo(52, 0);
    expect(edgeControlGeometry.shield.width).toBeCloseTo(39, 0);
    expect(edgeControlGeometry.shield.height).toBeCloseTo(39, 0);
    for (const control of Object.values(edgeControlGeometry)) {
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(390);
      expect(control.top).toBeGreaterThanOrEqual(0);
      expect(control.bottom).toBeLessThanOrEqual(660);
    }
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
    expect(tableGeometry).toEqual({ collisions: 0, avatarSquare: 0, avatarRadius: "15px" });
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-table.png") });

    await guestTwoPage.locator(".table-bottom-tools").getByRole("button", { name: "聊天" }).click();
    await expect(guestTwoPage.locator(".table-screen")).toHaveAttribute("data-drawer", "chat");
    await expect(guestTwoPage.locator(".game-drawer.tab-chat")).toBeVisible();
    await guestTwoPage.waitForTimeout(280);
    const compactViewportGeometry = await guestTwoPage.evaluate(() => {
      const shell = document.querySelector(".app-shell")!.getBoundingClientRect();
      const drawer = document.querySelector(".game-drawer.drawer-left")!.getBoundingClientRect();
      return {
        shellHeight: shell.height,
        viewportHeight: innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        drawerInside: drawer.left >= 0 && drawer.top >= 0 && drawer.right <= innerWidth && drawer.bottom <= innerHeight
      };
    });
    expect(compactViewportGeometry.shellHeight).toBe(660);
    expect(compactViewportGeometry.viewportHeight).toBe(660);
    expect(compactViewportGeometry.documentHeight).toBe(660);
    expect(compactViewportGeometry.drawerInside).toBe(true);
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

    await expect(guestTwoPage.locator(".hero-seat").getByRole("button", { name: /互动/ })).toHaveCount(0);
    const interactionTarget = guestTwoPage.getByRole("button", { name: /与 .* 互动/ }).first();
    const targetSeatId = await interactionTarget.locator("xpath=ancestor::*[contains(@class,'seat')]").getAttribute("data-seat-id");
    const senderSeatId = await guestTwoPage.locator(".hero-seat").getAttribute("data-seat-id");
    expect(targetSeatId).toBeTruthy();
    expect(senderSeatId).toBeTruthy();
    await interactionTarget.click();
    await expect(guestTwoPage.locator(".player-interaction-card")).toBeVisible();
    const interactionGeometry = await guestTwoPage.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".player-interaction-card")!.getBoundingClientRect();
      const target = document.querySelector<HTMLElement>(`.seat[data-seat-id="${document.querySelector<HTMLElement>(".player-interaction-card")!.dataset.targetSeatId}"] .avatar-ring`)!.getBoundingClientRect();
      const board = document.querySelector<HTMLElement>(".board-cards")!.getBoundingClientRect();
      const overlapsBoard = panel.left < board.right && panel.right > board.left && panel.top < board.bottom && panel.bottom > board.top;
      const gap = Math.hypot(panel.left + panel.width / 2 - (target.left + target.width / 2), panel.top + panel.height / 2 - (target.top + target.height / 2));
      return { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, overlapsBoard, gap };
    });
    expect(interactionGeometry.left).toBeGreaterThanOrEqual(8);
    expect(interactionGeometry.right).toBeLessThanOrEqual(guestTwoPage.viewportSize()!.width - 8);
    expect(interactionGeometry.top).toBeGreaterThanOrEqual(8);
    expect(interactionGeometry.bottom).toBeLessThanOrEqual(guestTwoPage.viewportSize()!.height - 8);
    expect(interactionGeometry.overlapsBoard).toBe(false);
    expect(interactionGeometry.gap).toBeLessThan(190);
    await expect(guestTwoPage.locator(".player-interaction-card>div>button")).toHaveCount(4);
    await guestTwoPage.screenshot({ path: testInfo.outputPath("mobile-player-interaction.png") });
    await guestTwoPage.locator(".board-room-countdown").click();
    await expect(guestTwoPage.locator(".player-interaction-card")).toBeHidden();
    await interactionTarget.click();
    const otherTarget = guestTwoPage.getByRole("button", { name: /与 .* 互动/ }).nth(1);
    const otherTargetSeatId = await otherTarget.locator("xpath=ancestor::*[contains(@class,'seat')]").getAttribute("data-seat-id");
    await otherTarget.click();
    await expect(guestTwoPage.locator(".player-interaction-card")).toHaveAttribute("data-target-seat-id", otherTargetSeatId!);
    await interactionTarget.click();
    await expect(guestTwoPage.locator(".player-interaction-card")).toHaveAttribute("data-target-seat-id", targetSeatId!);
    await guestTwoPage.getByRole("button", { name: "送花" }).click();
    const effectRelation = `${senderSeatId}>${targetSeatId}`;
    await expect(guestOnePage.locator(".pixi-effects")).toHaveAttribute("data-active-effects", new RegExp(effectRelation));
    await expect(guestTwoPage.locator(".pixi-effects")).toHaveAttribute("data-active-effects", new RegExp(effectRelation));
    await expect.poll(async () => await guestTwoPage.locator(".pixi-effects").getAttribute("data-active-effect-count"), { timeout: 4_000 }).toBe("0");
    await guestOnePage.reload();
    await expect(guestOnePage.locator(".pixi-effects")).toHaveAttribute("data-active-effect-count", "0");
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
    const heroAvatarTopsAfterTurnChanges = await Promise.all(pages.map((playerPage) => playerPage.locator(".hero-seat .avatar-ring").evaluate((element) => element.getBoundingClientRect().top)));
    heroAvatarTopsAfterTurnChanges.forEach((top, index) => expect(Math.abs(top - heroAvatarTops[index])).toBeLessThanOrEqual(1));
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
          const hero = document.querySelector(".hero-seat")!;
          const parts = [".seat-info b", ".avatar-ring", ".seat-info span", ".seat-cards"].map((selector) => hero.querySelector(selector)!.getBoundingClientRect());
          const actions = [...document.querySelectorAll(".action-buttons .action")].map((element) => element.getBoundingClientRect());
          return Math.min(...parts.map((part) => part.top)) - Math.max(...actions.map((action) => action.bottom));
        });
        expect(actionGap).toBeGreaterThanOrEqual(3);
        const seatDockCollisions = await playerPage.evaluate(() => {
          const actions = [...document.querySelectorAll(".action-buttons .action")].map((element) => element.getBoundingClientRect());
          return [...document.querySelectorAll(".seat:not(.hero-seat)")].flatMap((seat, index) => {
            const parts = [".seat-info b", ".avatar-ring", ".seat-info span", ".seat-cards"]
              .map((selector) => seat.querySelector(selector)?.getBoundingClientRect())
              .filter((rect): rect is DOMRect => Boolean(rect));
            const left = Math.min(...parts.map((rect) => rect.left));
            const right = Math.max(...parts.map((rect) => rect.right));
            const top = Math.min(...parts.map((rect) => rect.top));
            const bottom = Math.max(...parts.map((rect) => rect.bottom));
            return actions.some((action) => left < action.right && right > action.left && top < action.bottom && bottom > action.top)
              ? [{ index, seat: { left, right, top, bottom }, actions: actions.map(({ left, right, top, bottom }) => ({ left, right, top, bottom })) }]
              : [];
          });
        });
        expect(seatDockCollisions).toEqual([]);
        await raise.click();
        await expect(playerPage.locator(".raise-panel")).toBeVisible();
        await expect(playerPage.locator(".raise-panel .quick-raises button")).toHaveCount(4);
        await expect(playerPage.locator(".turn-progress")).toBeHidden();
        await playerPage.screenshot({ path: testInfo.outputPath("mobile-raise.png") });
        await raise.click();
        break;
      }
    }

    const lateBottom = await lateGuestPage.locator(".table-stage").evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width * .5, y: rect.top + rect.height * .78 }; });
    const lateSeatChoice = lateGuestPage.locator(".late-seat-choice").last();
    const lateSeatCenter = await lateSeatChoice.evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
    await lateSeatChoice.click();
    await expect(lateGuestPage.locator(".pending-seat.hero-seat")).toBeVisible();
    const pendingSeatCenter = await lateGuestPage.locator(".pending-seat.hero-seat").evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
    expect(Math.hypot(pendingSeatCenter.x - lateBottom.x, pendingSeatCenter.y - lateBottom.y)).toBeLessThanOrEqual(2);
    expect(Math.hypot(pendingSeatCenter.x - lateSeatCenter.x, pendingSeatCenter.y - lateSeatCenter.y)).toBeGreaterThan(50);

    let revealedFoldedCard = false;
    for (let round = 0; round < 3; round += 1) {
      for (const playerPage of pages) {
        const fold = playerPage.locator(".action.fold");
        if (await fold.count() > 0 && await fold.isEnabled()) {
          await fold.click();
          await expect(playerPage.locator(".action-buttons")).toHaveCount(0);
          await expect(playerPage.locator(".seat.folded .action-bubble")).toHaveCount(0);
          if (!revealedFoldedCard) {
            const reveal = playerPage.getByRole("button", { name:"公开第 1 张底牌" });
            await expect(reveal).toBeVisible();
            await reveal.click();
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
    const activeLateSeatCenter = await lateGuestPage.locator(".hero-seat").evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
    expect(Math.hypot(activeLateSeatCenter.x - lateBottom.x, activeLateSeatCenter.y - lateBottom.y)).toBeLessThanOrEqual(2);
    await expect(guestTwoPage.locator(".hero-seat .seat-info span")).toHaveText(/\d{1,3}(,\d{3})*/);
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
    const settlementGeometry = await page.evaluate(() => {
      const hero = document.querySelector(".hero-seat")!;
      const heroParts = [".seat-info b", ".avatar-ring", ".seat-info span", ".seat-cards"].map((selector) => hero.querySelector(selector)!.getBoundingClientRect());
      const heroTop = Math.min(...heroParts.map((part) => part.top));
      const heroBottom = Math.max(...heroParts.map((part) => part.bottom));
      const summary = document.querySelector(".hand-settlement")!.getBoundingClientRect();
      const tools = document.querySelector(".table-bottom-tools")!.getBoundingClientRect();
      return { summaryGap: heroTop - summary.bottom, bottomGap: tools.top - heroBottom };
    });
    expect(settlementGeometry.summaryGap).toBeGreaterThanOrEqual(10);
    expect(settlementGeometry.bottomGap).toBeGreaterThanOrEqual(18);

    const activeCode = await page.evaluate(() => window.sessionStorage.getItem("poker-active-room"));
    expect(activeCode).toBeTruthy();
    const personalHistory = await (await page.context().request.get("/api/history")).json() as { hands: Array<{ roomCode: string }>; rooms: Array<{ roomCode: string; handCount: number; scoreboard: Array<{ delta: number }> }> };
    const roomHistory = personalHistory.rooms.find((entry) => entry.roomCode === activeCode);
    expect(roomHistory).toBeTruthy();
    expect(roomHistory!.handCount).toBeGreaterThanOrEqual(2);
    expect(roomHistory!.scoreboard).toHaveLength(4);
    expect(roomHistory!.scoreboard.map((entry) => entry.delta)).toEqual([...roomHistory!.scoreboard.map((entry) => entry.delta)].sort((a, b) => b - a));

    await guestOnePage.getByRole("button", { name: "牌桌功能" }).click();
    await guestOnePage.locator(".wpk-function-menu").getByRole("button", { name: /牌局回顾/ }).click();
    await expect(guestOnePage.locator(".game-drawer.tab-history")).toHaveClass(/drawer-left/);
    await guestOnePage.waitForTimeout(260);
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
