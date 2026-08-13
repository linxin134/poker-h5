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

    const actorIsOpponentByPage:boolean[] = [];

    for (const playerPage of [page, guestPage]) {
      // Framer Motion deals cards with a short 3-D spring. Assert the final
      // layout contract, not a projected width sampled mid-animation.
      await playerPage.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".seat:not(.pending-seat) .seat-cards .playing-card")].every((card) => {
        const opponent = Boolean(card.closest(".opponent-seat"));
        const rect = card.getBoundingClientRect();
        return Math.abs(rect.width - (opponent ? 12 : 28)) < .05 && Math.abs(rect.height - (opponent ? 17 : 40)) < .05;
      }), undefined, { timeout:5_000 });
      const heroSeatBeforeAction = await playerPage.locator(".hero-seat").boundingBox();
      const seatContract = await playerPage.evaluate(() => {
        type Box = { left:number; right:number; top:number; bottom:number; width:number; height:number };
        const box = (element:Element):Box => {
          const rect = element.getBoundingClientRect();
          return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height };
        };
        const overlaps = (a:Box, b:Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const stage = box(document.querySelector(".table-stage")!);
        const seats = [...document.querySelectorAll<HTMLElement>(".seat:not(.pending-seat)")].map((seat) => {
          const avatar = box(seat.querySelector(".avatar-ring")!);
          const name = box(seat.querySelector(".seat-name")!);
          const stack = box(seat.querySelector(".seat-stack")!);
          const dealerElement = seat.querySelector<HTMLElement>(".dealer-button");
          const betElement = seat.querySelector<HTMLElement>(".seat-bet");
          const cards = [...seat.querySelectorAll<HTMLElement>(".seat-cards .playing-card")].map(box);
          return {
            id:seat.dataset.seatId,
            hero:seat.classList.contains("hero-seat"),
            side:seat.classList.contains("seat-left") ? "left" : seat.classList.contains("seat-right") ? "right" : "center",
            seat:box(seat), avatar, name, stack, cards,
            dealer:dealerElement ? box(dealerElement) : null,
            bet:betElement ? box(betElement) : null,
            radius:getComputedStyle(seat.querySelector<HTMLElement>(".avatar-ring")!).borderRadius,
            imageRadius:getComputedStyle(seat.querySelector<HTMLElement>(".avatar-ring .game-avatar")!).borderRadius,
          };
        });
        const hero = seats.find((seat) => seat.hero)!;
        const opponents = seats.filter((seat) => !seat.hero);
        const board = box(document.querySelector(".board-cards")!);
        const pot = box(document.querySelector(".pot-badge")!);
        const feltStyle = getComputedStyle(document.querySelector<HTMLElement>(".fresh-felt")!);
        const stackStyle = getComputedStyle(document.querySelector<HTMLElement>(".seat-stack")!);
        const visibleBet = document.querySelector<HTMLElement>(".seat-bet");
        const topControls = [...document.querySelectorAll<HTMLElement>(".table-topbar button")].map(box);
        const bottomControls = [...document.querySelectorAll<HTMLElement>(".table-bottom-tools button,.emoji-tray .round-tool")].map(box);
        return {
          stage, hero, opponents, board, pot, topControls, bottomControls,
          palette:{
            felt:feltStyle.backgroundImage,
            feltBase:feltStyle.backgroundColor,
            stack:stackStyle.backgroundColor,
            stackText:stackStyle.color,
            betText:visibleBet ? getComputedStyle(visibleBet).color : "",
            betBackground:visibleBet ? getComputedStyle(visibleBet).backgroundColor : "",
          },
          avatarBoardCollisions:seats.filter((seat) => overlaps(seat.avatar, board)).length,
          toolSeatCollisions:[...topControls, ...bottomControls].flatMap((tool) => seats.filter((seat) => overlaps(tool, seat.avatar))).length,
        };
      });
      const overlapsBox = (a:{ left:number; right:number; top:number; bottom:number }, b:{ left:number; right:number; top:number; bottom:number }) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const overlapCount = (boxes:Array<{ left:number; right:number; top:number; bottom:number }>) => boxes.flatMap((item, index) => boxes.slice(index + 1).filter((other) => overlapsBox(item, other))).length;
      expect(seatContract.stage).toMatchObject({ top:0, bottom:660, height:660 });
      expect(seatContract.palette.feltBase).toBe("rgb(0, 96, 79)");
      expect(seatContract.palette.felt).toContain("rgb(8, 126, 103)");
      expect(seatContract.palette.felt).toContain("rgb(1, 91, 74)");
      expect(seatContract.palette.stack).toBe("rgba(5, 15, 15, 0.68)");
      expect(seatContract.palette.stackText).toBe("rgb(231, 241, 239)");
      if (seatContract.palette.betText) {
        expect(seatContract.palette.betText).toBe("rgb(213, 239, 235)");
        expect(seatContract.palette.betBackground).toBe("rgba(0, 0, 0, 0)");
      }
      expect(seatContract.hero.avatar).toMatchObject({ width:46, height:46 });
      expect(seatContract.hero.radius).toBe("12px");
      expect(seatContract.hero.imageRadius).toBe("10px");
      expect(seatContract.hero.cards).toHaveLength(2);
      for (const card of seatContract.hero.cards) {
        expect(card.width).toBeCloseTo(28, 1);
        expect(card.height).toBeCloseTo(40, 1);
      }
      expect(seatContract.hero.cards[0].top).toBeGreaterThanOrEqual(seatContract.hero.avatar.bottom + 3);
      expect(seatContract.hero.cards[1].left).toBeGreaterThanOrEqual(seatContract.hero.cards[0].right + 1);
      expect(seatContract.hero.stack.top).toBeGreaterThan(seatContract.hero.cards[0].bottom);
      const seatUiBoxes = [seatContract.hero, ...seatContract.opponents];
      for (const seat of seatUiBoxes) {
        if (seat.bet) {
          expect(overlapCount([seat.name, seat.stack, seat.bet])).toBe(0);
          expect(overlapsBox(seat.bet, seat.avatar)).toBe(false);
        }
        if (seat.dealer) {
          expect(overlapsBox(seat.dealer, seat.stack)).toBe(false);
          expect(Math.abs((seat.dealer.top + seat.dealer.height / 2) - (seat.stack.top + seat.stack.height / 2))).toBeLessThanOrEqual(1);
          if (seat.hero || seat.side !== "right") expect(seat.dealer.left).toBeGreaterThanOrEqual(seat.stack.right);
          else expect(seat.dealer.right).toBeLessThanOrEqual(seat.stack.left);
        }
      }
      for (const opponent of seatContract.opponents) {
        expect(opponent.avatar).toMatchObject({ width:46, height:46 });
        expect(opponent.radius).toBe("12px");
        expect(opponent.imageRadius).toBe("10px");
        expect(opponent.stack.top).toBeGreaterThanOrEqual(opponent.avatar.bottom + 3);
        expect(opponent.cards).toHaveLength(2);
        for (const card of opponent.cards) {
          expect(card.width).toBeCloseTo(12, 1);
          expect(card.height).toBeCloseTo(17, 1);
        }
        expect(opponent.cards[0].left - opponent.avatar.left).toBeCloseTo(35, 0);
        expect(opponent.cards[0].top - opponent.avatar.top).toBeCloseTo(29, 0);
        expect(opponent.cards[1].left - opponent.cards[0].left).toBeCloseTo(8, 0);
        expect(opponent.cards[0].right).toBeGreaterThan(opponent.avatar.right);
      }
      expect(seatContract.pot.bottom).toBeLessThan(seatContract.stage.top + seatContract.stage.height * .425);
      expect(seatContract.board.width).toBeLessThanOrEqual(188);
      expect(seatContract.avatarBoardCollisions).toBe(0);
      expect(seatContract.toolSeatCollisions).toBe(0);
      expect(seatContract.topControls.every(({ width, height }) => width >= 40 && width <= 44 && height >= 40 && height <= 44)).toBe(true);
      expect(seatContract.bottomControls.every(({ width, height }) => width === 44 && height === 44)).toBe(true);
      const dealerDoesNotMoveStack = await playerPage.locator(".seat:has(.dealer-button)").evaluate((seat) => {
        const stack = seat.querySelector<HTMLElement>(".seat-stack")!;
        const dealer = seat.querySelector<HTMLElement>(".dealer-button")!;
        const box = () => {
          const rect = stack.getBoundingClientRect();
          return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
        };
        const before = box();
        dealer.style.display = "none";
        const withoutDealer = box();
        dealer.style.display = "";
        return { before, withoutDealer, restored:box() };
      });
      expect(dealerDoesNotMoveStack.withoutDealer).toEqual(dealerDoesNotMoveStack.before);
      expect(dealerDoesNotMoveStack.restored).toEqual(dealerDoesNotMoveStack.before);
      const activeTimerContract = await playerPage.evaluate(() => {
        const activeSeat = document.querySelector<HTMLElement>(".seat.active")!;
        const avatar = activeSeat.querySelector<HTMLElement>(".avatar-ring")!;
        const timer = avatar.querySelector<HTMLElement>(".timer-ring")!;
        const countdown = avatar.querySelector<HTMLElement>(".seat-countdown")!;
        const box = (element:HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
        };
        const avatarBox = box(avatar);
        const timerBox = box(timer);
        const countdownBox = box(countdown);
        const avatarStyle = getComputedStyle(avatar);
        const timerStyle = getComputedStyle(timer);
        const countdownStyle = getComputedStyle(countdown);
        return {
          avatar:avatarBox,
          timer:timerBox,
          countdown:countdownBox,
          activeIsOpponent:activeSeat.classList.contains("opponent-seat"),
          avatarBorder:avatarStyle.borderColor,
          avatarRadius:avatarStyle.borderRadius,
          avatarShadow:avatarStyle.boxShadow,
          timerBorder:timerStyle.borderTopWidth,
          timerRadius:timerStyle.borderRadius,
          timerBackground:timerStyle.backgroundImage,
          timerTransform:timerStyle.transform,
          timerAnimation:timerStyle.animationName,
          timerFilter:timerStyle.filter,
          countdownBorder:countdownStyle.borderTopWidth,
          countdownRadius:countdownStyle.borderRadius,
          countdownBackground:countdownStyle.backgroundColor,
          countdownCenter:{
            x:countdownBox.left + countdownBox.width / 2,
            y:countdownBox.top + countdownBox.height / 2,
          },
          timerCenter:{
            x:timerBox.left + timerBox.width / 2,
            y:timerBox.top + timerBox.height / 2,
          },
          avatarCenter:{
            x:avatarBox.left + avatarBox.width / 2,
            y:avatarBox.top + avatarBox.height / 2,
          },
        };
      });
      expect(activeTimerContract.avatar).toMatchObject({ width:46, height:46 });
      expect(activeTimerContract.timer).toMatchObject({ width:42, height:6 });
      expect(activeTimerContract.countdown).toMatchObject({ width:38, height:12 });
      expect(activeTimerContract.avatarRadius).toBe("12px");
      expect(activeTimerContract.avatarBorder).toBe("rgb(236, 243, 240)");
      expect(activeTimerContract.avatarShadow).not.toContain("67, 220, 116");
      expect(activeTimerContract.timerBorder).toBe("0px");
      expect(activeTimerContract.timerRadius).toBe("999px");
      expect(activeTimerContract.timerBackground).toContain("linear-gradient");
      expect(activeTimerContract.timerBackground).toContain("rgb(40, 213, 140)");
      expect(activeTimerContract.timerAnimation).toBe("none");
      expect(activeTimerContract.timerFilter).toBe("none");
      expect(activeTimerContract.countdownBorder).toBe("0px");
      expect(activeTimerContract.countdownRadius).toBe("999px");
      expect(activeTimerContract.countdownBackground).toBe("rgba(0, 0, 0, 0)");
      expect(activeTimerContract.timerCenter.x).toBeCloseTo(activeTimerContract.avatarCenter.x, 0);
      expect(activeTimerContract.countdownCenter.x).toBeCloseTo(activeTimerContract.avatarCenter.x, 0);
      expect(activeTimerContract.countdownCenter.y).toBeCloseTo(activeTimerContract.timerCenter.y, 0);
      expect(activeTimerContract.timer.top).toBeGreaterThanOrEqual(activeTimerContract.avatar.top + 1);
      expect(activeTimerContract.timer.top + activeTimerContract.timer.height).toBeLessThanOrEqual(activeTimerContract.avatar.top + 10);
      actorIsOpponentByPage.push(activeTimerContract.activeIsOpponent);
      const urgentTimerContract = await playerPage.locator(".seat.active .avatar-ring").evaluate((avatarElement) => {
        const avatar = avatarElement as HTMLElement;
        const timer = avatar.querySelector<HTMLElement>(".timer-ring")!;
        const countdown = avatar.querySelector<HTMLElement>(".seat-countdown")!;
        const box = (element:HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
        };
        const wasUrgent = timer.classList.contains("urgent");
        timer.classList.remove("urgent");
        const regularBackground = getComputedStyle(timer).backgroundImage;
        const childCount = avatar.childElementCount;
        timer.classList.add("urgent");
        const urgentBackground = getComputedStyle(timer).backgroundImage;
        const result = {
          avatar:box(avatar),
          timer:box(timer),
          countdown:box(countdown),
          childCount,
          urgentChildCount:avatar.childElementCount,
          regularBackground,
          urgentBackground,
          filter:getComputedStyle(timer).filter,
        };
        timer.classList.toggle("urgent", wasUrgent);
        return result;
      });
      expect(urgentTimerContract.timer).toMatchObject({ width:42, height:6 });
      expect(urgentTimerContract.countdown).toMatchObject({ width:38, height:12 });
      expect(urgentTimerContract.urgentChildCount).toBe(urgentTimerContract.childCount);
      expect(urgentTimerContract.urgentBackground).not.toBe(urgentTimerContract.regularBackground);
      expect(urgentTimerContract.urgentBackground).toContain("rgb(240, 161, 26)");
      expect(urgentTimerContract.filter).toBe("none");
      const timerStateGeometry = await playerPage.locator(".seat.active").evaluate((seatElement) => {
        const seat = seatElement as HTMLElement;
        const avatar = seat.querySelector<HTMLElement>(".avatar-ring")!;
        const box = (element:HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
        };
        const active = { seat:box(seat), avatar:box(avatar) };
        seat.classList.remove("active");
        const inactive = { seat:box(seat), avatar:box(avatar) };
        seat.classList.add("active");
        return { active, inactive, restored:{ seat:box(seat), avatar:box(avatar) } };
      });
      expect(timerStateGeometry.inactive).toEqual(timerStateGeometry.active);
      expect(timerStateGeometry.restored).toEqual(timerStateGeometry.active);
      const geometry = await playerPage.evaluate(() => {
        const stage = document.querySelector(".table-stage")!.getBoundingClientRect();
        const hero = document.querySelector(".hero-seat")!.getBoundingClientRect();
        const avatarElement = document.querySelector<HTMLElement>(".hero-seat .avatar-ring")!;
        const avatar = avatarElement.getBoundingClientRect();
        const avatarImage = avatarElement.querySelector<HTMLElement>(".game-avatar")!;
        const rect = (selector:string) => {
          const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          return { width:box.width, height:box.height, left:box.left, right:box.right, top:box.top, bottom:box.bottom };
        };
        const board = rect(".board-cards");
        const occupied = [...document.querySelectorAll<HTMLElement>(".seat .avatar-ring")].map((element) => element.getBoundingClientRect());
        const controls = {
          menu:rect(".table-menu-trigger"), top:rect(".table-tools button"), bottom:rect(".table-bottom-tools button"),
          emoji:rect(".round-tool")
        };
        const collision = (a:DOMRect | ReturnType<typeof rect>, b:DOMRect | ReturnType<typeof rect>) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          heroOffset:Math.hypot(hero.left + hero.width / 2 - (stage.left + stage.width / 2), hero.top + hero.height / 2 - (stage.top + stage.height * .82)),
          stage:{ top:stage.top, bottom:stage.bottom, height:stage.height },
          avatar:{
            width:avatar.width,
            height:avatar.height,
            radius:getComputedStyle(avatarElement).borderRadius,
            imageRadius:getComputedStyle(avatarImage).borderRadius,
          }, controls,
          avatarBoardCollisions:occupied.filter((item) => collision(item, board)).length,
          clipped:Object.values(controls).some((item) => item.left < 0 || item.right > innerWidth || item.top < 0 || item.bottom > innerHeight),
          controlSeatCollisions:Object.values(controls).flatMap((control) => occupied.filter((item) => collision(control, item))).length
        };
      });
      expect(geometry.heroOffset).toBeLessThanOrEqual(2);
      expect(geometry.stage).toEqual({ top:0, bottom:660, height:660 });
      expect(geometry.avatar).toEqual({ width:46, height:46, radius:"12px", imageRadius:"10px" });
      expect(geometry.controls.menu.width).toBeCloseTo(40, 0);
      expect(geometry.controls.top.width).toBeCloseTo(44, 0);
      expect(geometry.controls.bottom.width).toBeCloseTo(44, 0);
      expect(geometry.controls.emoji.width).toBeCloseTo(44, 0);
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
        expect(orbitGeometry.raise.x).toBeCloseTo(orbitGeometry.hero.x, 1);
        expect(orbitGeometry.raise.y - orbitGeometry.hero.y).toBeCloseTo(-12, 1);
        expect(orbitGeometry.raise.width).toBeCloseTo(56, 1);
        expect(orbitGeometry.fold.width).toBeCloseTo(46, 1);
        expect(orbitGeometry.fold.width).toBeCloseTo(orbitGeometry.right.width, 1);
        expect(orbitGeometry.fold.height).toBeCloseTo(orbitGeometry.right.height, 1);
        expect(orbitGeometry.fold.y).toBeCloseTo(orbitGeometry.right.y, 1);
        expect(Math.abs(orbitGeometry.fold.x - orbitGeometry.hero.x)).toBeCloseTo(70, 1);
        expect(Math.abs(orbitGeometry.right.x - orbitGeometry.hero.x)).toBeCloseTo(70, 1);
        expect(orbitGeometry.fold.y - orbitGeometry.hero.y).toBeCloseTo(13, 1);
        await expect(playerPage.locator(".action-arc button")).toHaveCount(5);
        const presetArc = await playerPage.locator(".action-arc button").evaluateAll((buttons) => buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
        }));
        expect(presetArc[0].y).toBeCloseTo(presetArc[4].y, 1);
        expect(presetArc[1].y).toBeCloseTo(presetArc[3].y, 1);
        expect(presetArc[0].x + presetArc[4].x).toBeCloseTo(2 * presetArc[2].x, 1);
        expect(presetArc[1].x + presetArc[3].x).toBeCloseTo(2 * presetArc[2].x, 1);
        expect(presetArc[2].y).toBeLessThan(presetArc[1].y);
        expect(presetArc[1].y).toBeLessThan(presetArc[0].y);
        const arcDx = presetArc[4].x - presetArc[2].x;
        const arcDy = presetArc[4].y - presetArc[2].y;
        const arcRadius = (arcDx * arcDx + arcDy * arcDy) / (2 * arcDy);
        const arcCircleY = presetArc[2].y + arcRadius;
        const arcDistances = presetArc.map((point) => Math.hypot(point.x - presetArc[2].x, point.y - arcCircleY));
        expect(Math.max(...arcDistances) - Math.min(...arcDistances)).toBeLessThanOrEqual(.35);
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
    expect(actorIsOpponentByPage).toContain(false);
    expect(actorIsOpponentByPage).toContain(true);
    await page.screenshot({ path:testInfo.outputPath("active-2-player-390x660.png") });
  } finally {
    await guest.close();
  }
});
