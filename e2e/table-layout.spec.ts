import { expect, test } from "@playwright/test";

test("390x660 牌桌保持对称座位、大头像和放大工具按钮", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width:390, height:660 });
  const stamp = Date.now().toString(36);
  const nickname = `布局${stamp.slice(-5)}`;
  const guest = await browser.newContext({ viewport:{ width:390, height:660 } });
  const guestPage = await guest.newPage();

  try {
    await page.context().request.post("/api/auth/register", { data:{ email:`layout-host-${stamp}@local.test`, password:"test-pass-123", nickname } });
    await guest.request.post("http://127.0.0.1:5173/api/auth/register", { data:{ email:`layout-guest-${stamp}@local.test`, password:"test-pass-123", nickname:`客人${stamp.slice(-4)}` } });

    await page.goto("/");
    await page.getByRole("button", { name:"创建房间" }).click();
    await page.getByRole("button", { name:"立即开局" }).click();
    await page.locator(".waiting-table-seat.empty").first().click();

    const waitingLayout = await page.locator(".waiting-table-stage").evaluate((stageElement) => {
      const stage = stageElement.getBoundingClientRect();
      const points = [...stageElement.querySelectorAll<HTMLElement>(".waiting-table-seat")].map((seat) => {
        const rect = seat.getBoundingClientRect();
        return { x:(rect.left + rect.width / 2 - stage.left) / stage.width * 100, y:(rect.top + rect.height / 2 - stage.top) / stage.height * 100 };
      });
      return { points, width:stage.width, height:stage.height };
    });
    expect(waitingLayout.width).toBe(390);
    expect(waitingLayout.height).toBe(660);
    expect(waitingLayout.points.some(({ x, y }) => Math.abs(x - 50) < .2 && Math.abs(y - 18) < .2)).toBe(true);
    expect(waitingLayout.points.some(({ x, y }) => Math.abs(x - 50) < .2 && Math.abs(y - 82) < .2)).toBe(true);
    const leftRail = waitingLayout.points.filter(({ x }) => x < 40).sort((a, b) => a.y - b.y);
    const rightRail = waitingLayout.points.filter(({ x }) => x > 60).sort((a, b) => a.y - b.y);
    leftRail.forEach((point, index) => expect(point.y).toBeCloseTo(rightRail[index].y, 1));
    expect(Math.min(...waitingLayout.points.map(({ y }) => y)) + Math.max(...waitingLayout.points.map(({ y }) => y))).toBeCloseTo(100, 1);
    await page.screenshot({ path:testInfo.outputPath("waiting-8-seat-390x660.png") });

    await guestPage.goto("http://127.0.0.1:5173/");
    const room = guestPage.locator(".public-room-list article", { hasText:nickname });
    await room.getByRole("button", { name:/加入/ }).click();
    await guestPage.locator(".waiting-table-seat.empty").first().click();
    await expect(page.locator(".waiting-table-seat.occupied")).toHaveCount(2);
    await page.getByRole("button", { name:/开始牌局/ }).click();
    await expect(page.locator(".fresh-table")).toBeVisible();
    await expect(guestPage.locator(".fresh-table")).toBeVisible();

    for (const playerPage of [page, guestPage]) {
      const heroSeatBeforeAction = await playerPage.locator(".hero-seat").boundingBox();
      const geometry = await playerPage.evaluate(() => {
        const stage = document.querySelector(".table-stage")!.getBoundingClientRect();
        const hero = document.querySelector(".hero-seat")!.getBoundingClientRect();
        const avatar = document.querySelector<HTMLElement>(".hero-seat .avatar-ring")!.getBoundingClientRect();
        const rect = (selector:string) => {
          const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          return { width:box.width, height:box.height, left:box.left, right:box.right, top:box.top, bottom:box.bottom };
        };
        const board = rect(".board-cards");
        const occupied = [...document.querySelectorAll<HTMLElement>(".seat .avatar-ring")].map((element) => element.getBoundingClientRect());
        const controls = {
          menu:rect(".table-menu-trigger"), top:rect(".table-tools button"), bottom:rect(".table-bottom-tools button"),
          emoji:rect(".round-tool"), shield:rect(".table-shield")
        };
        const collision = (a:DOMRect | ReturnType<typeof rect>, b:DOMRect | ReturnType<typeof rect>) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          heroOffset:Math.hypot(hero.left + hero.width / 2 - (stage.left + stage.width / 2), hero.top + hero.height / 2 - (stage.top + stage.height * .82)),
          stage:{ top:stage.top, bottom:stage.bottom, height:stage.height },
          avatar:{ width:avatar.width, height:avatar.height }, controls,
          avatarBoardCollisions:occupied.filter((item) => collision(item, board)).length,
          clipped:Object.values(controls).some((item) => item.left < 0 || item.right > innerWidth || item.top < 0 || item.bottom > innerHeight),
          controlSeatCollisions:Object.values(controls).flatMap((control) => occupied.filter((item) => collision(control, item))).length
        };
      });
      expect(geometry.heroOffset).toBeLessThanOrEqual(2);
      expect(geometry.stage).toEqual({ top:0, bottom:660, height:660 });
      expect(geometry.avatar).toEqual({ width:46, height:46 });
      expect(geometry.controls.menu.width).toBeCloseTo(40, 0);
      expect(geometry.controls.top.width).toBeCloseTo(52, 0);
      expect(geometry.controls.bottom.width).toBeCloseTo(52, 0);
      expect(geometry.controls.emoji.width).toBeCloseTo(52, 0);
      expect(geometry.controls.shield.width).toBeGreaterThanOrEqual(38);
      expect(geometry.controls.shield.width).toBeLessThanOrEqual(39.5);
      expect(geometry.avatarBoardCollisions).toBe(0);
      expect(geometry.clipped).toBe(false);
      expect(geometry.controlSeatCollisions).toBe(0);

      const actionDock = playerPage.locator(".action-dock.my-turn");
      if (await actionDock.count()) {
        const orbitGeometry = await playerPage.evaluate(() => {
          const center = (selector:string) => {
            const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2, width:rect.width, height:rect.height };
          };
          const hero = center(".hero-seat .avatar-ring");
          const raise = center(".action-buttons .action.raise");
          const fold = center(".action-buttons .action.fold");
          const right = center(".action-buttons .action.check,.action-buttons .action.call,.action-buttons .action.allin");
          return { hero, raise, fold, right };
        });
        expect(Math.hypot(orbitGeometry.hero.x - orbitGeometry.raise.x, orbitGeometry.hero.y - orbitGeometry.raise.y)).toBeLessThanOrEqual(1);
        expect(orbitGeometry.raise.width).toBeCloseTo(56, 1);
        expect(orbitGeometry.fold.width).toBeCloseTo(46, 1);
        expect(orbitGeometry.fold.width).toBeCloseTo(orbitGeometry.right.width, 1);
        expect(orbitGeometry.fold.height).toBeCloseTo(orbitGeometry.right.height, 1);
        expect(orbitGeometry.fold.y).toBeCloseTo(orbitGeometry.right.y, 1);
        await expect(playerPage.locator(".action-arc button")).toHaveCount(5);
        await playerPage.locator(".action-buttons .action.raise").dispatchEvent("pointerdown", { pointerType:"touch", isPrimary:true, button:0 });
        await expect(playerPage.locator(".raise-panel.raise-rail")).toBeVisible();
        const railBox = await playerPage.locator(".raise-panel.raise-rail").boundingBox();
        expect(railBox!.height).toBeGreaterThan(railBox!.width);
        const heroSeatWithRail = await playerPage.locator(".hero-seat").boundingBox();
        expect(heroSeatWithRail).toEqual(heroSeatBeforeAction);
        await playerPage.screenshot({ path:testInfo.outputPath("raise-orbit-390x660.png") });
        await playerPage.locator(".raise-backdrop").dispatchEvent("click");
      }
    }
    await page.screenshot({ path:testInfo.outputPath("active-2-player-390x660.png") });
  } finally {
    await guest.close();
  }
});
