import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RoomClientMessage, RoomView } from "../src/multiplayer/types";

const origin = "http://127.0.0.1:5173";

type Harness = { socket:WebSocket; room:RoomView | null; revision:number };

async function register(context:BrowserContext, stamp:string, index:number) {
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data:{ email:`seat-matrix-${index}-${stamp}@local.test`, password:"test-pass-123", nickname:`座位验收${index + 1}` }
  });
  expect(response.ok()).toBe(true);
}

async function openHarness(page:Page, code:string) {
  await page.goto(origin);
  await page.evaluate((roomCode) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/rooms/${roomCode}/socket`);
    const harness:Harness = { socket, room:null, revision:0 };
    (window as typeof window & { __seatMatrixHarness?:Harness }).__seatMatrixHarness = harness;
    const timeout = window.setTimeout(() => reject(new Error("room socket timeout")), 5_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type:string; room?:RoomView };
      if (message.type === "room" && message.room) {
        harness.room = message.room;
        harness.revision += 1;
        window.clearTimeout(timeout);
        resolve();
      }
    };
    socket.onerror = () => reject(new Error("room socket failed"));
  }), code);
}

async function sendAndWait(observer:Page, actor:Page, message:RoomClientMessage) {
  const before = await observer.evaluate(() => (window as typeof window & { __seatMatrixHarness?:Harness }).__seatMatrixHarness?.revision ?? 0);
  await actor.evaluate((payload) => {
    const harness = (window as typeof window & { __seatMatrixHarness?:Harness }).__seatMatrixHarness;
    if (!harness || harness.socket.readyState !== WebSocket.OPEN) throw new Error("room socket unavailable");
    harness.socket.send(JSON.stringify(payload));
  }, message);
  await expect.poll(() => observer.evaluate(() => (window as typeof window & { __seatMatrixHarness?:Harness }).__seatMatrixHarness?.revision ?? 0)).toBeGreaterThan(before);
}

test("8个玩家视角的昵称、筹码、下注与D标记互不遮挡", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile visual matrix");
  test.setTimeout(180_000);
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  const contexts:BrowserContext[] = [page.context()];
  const pages:Page[] = [page];

  try {
    await page.setViewportSize({ width:390, height:660 });
    for (let index = 1; index < 8; index += 1) {
      const context = await browser.newContext({ viewport:{ width:390, height:660 } });
      contexts.push(context);
      pages.push(await context.newPage());
    }
    for (let index = 0; index < 8; index += 1) await register(contexts[index], stamp, index);

    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data:{ durationMinutes:30, capacity:8, startingStack:200, smallBlind:1, bigBlind:2 }
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json() as { code:string };
    for (const context of contexts.slice(1)) expect((await context.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    for (const playerPage of pages) await openHarness(playerPage, code);
    for (let index = 0; index < 8; index += 1) await sendAndWait(pages[0], pages[index], { type:"sit", seatIndex:index });
    await sendAndWait(pages[1], pages[0], { type:"start" });

    for (const playerPage of pages) {
      await playerPage.evaluate((roomCode) => {
        const harness = (window as typeof window & { __seatMatrixHarness?:Harness }).__seatMatrixHarness;
        harness?.socket.close();
        sessionStorage.setItem("poker-active-room", roomCode);
      }, code);
      await playerPage.reload();
      await expect(playerPage.locator(".fresh-table")).toBeVisible({ timeout:10_000 });
      await expect(playerPage.locator(".seat:not(.pending-seat)")).toHaveCount(8);
    }

    const dealerPlacements = new Set<string>();
    const betPlacements = new Set<string>();
    for (let perspective = 0; perspective < pages.length; perspective += 1) {
      const playerPage = pages[perspective];
      const contract = await playerPage.evaluate(() => {
        type Box = { left:number; right:number; top:number; bottom:number; width:number; height:number };
        const box = (element:Element):Box => {
          const rect = element.getBoundingClientRect();
          return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height };
        };
        const overlaps = (a:Box, b:Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const seats = [...document.querySelectorAll<HTMLElement>(".seat:not(.pending-seat)")].map((seat) => {
          const child = (selector:string) => seat.querySelector<HTMLElement>(selector);
          const name = box(child(".seat-name")!);
          const avatar = box(child(".avatar-ring")!);
          const stack = box(child(".seat-stack")!);
          const cardsElement = child(".seat-cards");
          const betElement = child(".seat-bet");
          const dealerElement = child(".dealer-button");
          const bet = betElement ? box(betElement) : null;
          const cards = cardsElement ? box(cardsElement) : null;
          const dealer = dealerElement ? box(dealerElement) : null;
          const side = seat.classList.contains("seat-left") ? "left" : seat.classList.contains("seat-right") ? "right" : seat.classList.contains("hero-seat") ? "hero" : "top";
          const collisions:string[] = [];
          if (bet && overlaps(bet, name)) collisions.push("bet-name");
          if (bet && overlaps(bet, avatar)) collisions.push("bet-avatar");
          if (bet && overlaps(bet, stack)) collisions.push("bet-stack");
          if (bet && cards && overlaps(bet, cards)) collisions.push("bet-cards");
          if (dealer && overlaps(dealer, name)) collisions.push("dealer-name");
          if (dealer && overlaps(dealer, avatar)) collisions.push("dealer-avatar");
          if (dealer && overlaps(dealer, stack)) collisions.push("dealer-stack");
          if (seat.classList.contains("hero-seat") && bet && bet.bottom > name.top) collisions.push("hero-bet-not-above-id");
          return {
            side, name, avatar, stack, cards, bet, dealer, collisions,
            clipped:[name, avatar, stack, ...(bet ? [bet] : []), ...(dealer ? [dealer] : [])].some((item) => item.left < 0 || item.right > innerWidth || item.top < 0 || item.bottom > innerHeight)
          };
        });
        const stage = box(document.querySelector(".table-stage")!);
        const pot = box(document.querySelector(".pot-badge")!);
        const boardElement = document.querySelector<HTMLElement>(".board-cards")!;
        const board = box(boardElement);
        return { seats, dealer:seats.find((seat) => seat.dealer)!, stage, pot, board, boardVisible:getComputedStyle(boardElement).display !== "none" };
      });

      expect(contract.seats.flatMap((seat) => seat.collisions), JSON.stringify(contract.seats)).toEqual([]);
      expect(contract.seats.some((seat) => seat.clipped), JSON.stringify(contract.seats)).toBe(false);
      expect(contract.pot.top - contract.stage.top).toBeCloseTo(contract.stage.height * .325 - contract.pot.height / 2, 0);
      if (contract.boardVisible) expect(contract.board.top - contract.pot.bottom).toBeGreaterThanOrEqual(45);
      for (const seat of contract.seats.filter((item) => item.bet)) {
        const bet = seat.bet!;
        if (seat.side === "left") {
          expect(Math.abs((bet.top + bet.height / 2) - (seat.avatar.top + seat.avatar.height / 2))).toBeLessThanOrEqual(1);
          expect(bet.left - seat.avatar.right).toBeGreaterThanOrEqual(11);
          expect(bet.left - seat.avatar.right).toBeLessThanOrEqual(13);
        } else if (seat.side === "right") {
          expect(Math.abs((bet.top + bet.height / 2) - (seat.avatar.top + seat.avatar.height / 2))).toBeLessThanOrEqual(1);
          expect(seat.avatar.left - bet.right).toBeGreaterThanOrEqual(11);
          expect(seat.avatar.left - bet.right).toBeLessThanOrEqual(13);
        } else if (seat.side === "hero") {
          expect(Math.abs((bet.left + bet.width / 2) - (seat.avatar.left + seat.avatar.width / 2))).toBeLessThanOrEqual(1);
          expect(seat.name.top - bet.bottom).toBeGreaterThanOrEqual(4);
          expect(seat.name.top - bet.bottom).toBeLessThanOrEqual(6);
        } else {
          expect(Math.abs((bet.top + bet.height / 2) - (seat.avatar.top + seat.avatar.height / 2))).toBeLessThanOrEqual(1);
          expect(seat.avatar.left - bet.right).toBeGreaterThanOrEqual(11);
          expect(seat.avatar.left - bet.right).toBeLessThanOrEqual(13);
        }
        betPlacements.add(seat.side);
      }
      const betDoesNotMoveSeat = await playerPage.locator(".seat:has(.seat-bet)").evaluateAll((seats) => seats.map((seat) => {
        const bet = seat.querySelector<HTMLElement>(":scope>.seat-bet")!;
        const read = () => [".seat-name", ".avatar-ring", ".seat-stack", ".dealer-button"].map((selector) => {
          const element = seat.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
        });
        const before = read();
        bet.style.display = "none";
        const hidden = read();
        bet.style.display = "";
        return { before, hidden, restored:read() };
      }));
      for (const geometry of betDoesNotMoveSeat) {
        expect(geometry.hidden).toEqual(geometry.before);
        expect(geometry.restored).toEqual(geometry.before);
      }
      const dealer = contract.dealer;
      expect(Math.abs((dealer.dealer!.top + dealer.dealer!.height / 2) - (dealer.stack.top + dealer.stack.height / 2))).toBeLessThanOrEqual(1);
      if (dealer.side === "right") expect(dealer.dealer!.right).toBeLessThanOrEqual(dealer.stack.left);
      else expect(dealer.dealer!.left).toBeGreaterThanOrEqual(dealer.stack.right);
      dealerPlacements.add(dealer.side);
      const dealerDoesNotMoveStack = await playerPage.locator(".seat:has(.dealer-button)").evaluate((seat) => {
        const stack = seat.querySelector<HTMLElement>(".seat-stack")!;
        const dealer = seat.querySelector<HTMLElement>(".dealer-button")!;
        const box = () => {
          const rect = stack.getBoundingClientRect();
          return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
        };
        const before = box();
        dealer.style.display = "none";
        const hidden = box();
        dealer.style.display = "";
        return { before, hidden, restored:box() };
      });
      expect(dealerDoesNotMoveStack.hidden).toEqual(dealerDoesNotMoveStack.before);
      expect(dealerDoesNotMoveStack.restored).toEqual(dealerDoesNotMoveStack.before);
      await playerPage.screenshot({ path:testInfo.outputPath(`seat-perspective-${perspective + 1}-${dealer.side}-390x660.png`) });
    }
    expect([...dealerPlacements].sort()).toEqual(["hero", "left", "right", "top"]);
    expect([...betPlacements].sort()).toEqual(["hero", "left", "right", "top"]);

    const actorIndex = await Promise.all(pages.map((playerPage) => playerPage.locator(".action.fold:enabled").count())).then((counts) => counts.findIndex(Boolean));
    expect(actorIndex).toBeGreaterThanOrEqual(0);
    const foldingPage = pages[actorIndex];
    const foldedSeatId = await foldingPage.locator(".hero-seat").getAttribute("data-seat-id");
    expect(foldedSeatId).toBeTruthy();
    const avatarBeforeFold = await Promise.all(pages.map((playerPage) => playerPage.locator(`.seat[data-seat-id="${foldedSeatId}"]>.avatar-ring`).evaluate((avatar) => {
      const rect = avatar.getBoundingClientRect();
      return { left:rect.left, top:rect.top, width:rect.width, height:rect.height };
    })));
    await foldingPage.locator(".action.fold:enabled").dispatchEvent("click");
    await foldingPage.waitForTimeout(450);
    for (let perspective = 0; perspective < pages.length; perspective += 1) {
      const playerPage = pages[perspective];
      const foldedSeat = playerPage.locator(`.seat[data-seat-id="${foldedSeatId}"]`);
      await expect(foldedSeat.locator(":scope > .action-bubble.action-fold")).toHaveText("弃牌");
      const geometry = await foldedSeat.evaluate((seat) => {
        const avatar = seat.querySelector<HTMLElement>(":scope>.avatar-ring")!.getBoundingClientRect();
        const status = seat.querySelector<HTMLElement>(":scope>.action-bubble.action-fold")!;
        const overlay = status.getBoundingClientRect();
        const style = getComputedStyle(status);
        const name = seat.querySelector<HTMLElement>(":scope>.seat-name")!;
        const stack = seat.querySelector<HTMLElement>(":scope>.seat-stack-line")!;
        return {
          avatar:{ left:avatar.left, top:avatar.top, width:avatar.width, height:avatar.height },
          overlay:{ left:overlay.left, top:overlay.top, width:overlay.width, height:overlay.height },
          centerDelta:Math.hypot(avatar.left + avatar.width / 2 - (overlay.left + overlay.width / 2), avatar.top + avatar.height / 2 - (overlay.top + overlay.height / 2)),
          color:style.color,
          opacity:style.opacity,
          textAlign:style.textAlign,
          radius:style.borderRadius,
          nameOpacity:getComputedStyle(name).opacity,
          nameFilter:getComputedStyle(name).filter,
          stackOpacity:getComputedStyle(stack).opacity,
          stackFilter:getComputedStyle(stack).filter,
        };
      });
      expect(geometry.avatar).toEqual(avatarBeforeFold[perspective]);
      expect(geometry.centerDelta).toBeLessThanOrEqual(.5);
      expect(geometry.overlay).toMatchObject({ width:46, height:46 });
      expect(geometry.color).toBe("rgb(217, 229, 227)");
      expect(geometry.opacity).toBe("1");
      expect(geometry.textAlign).toBe("center");
      expect(geometry.radius).toBe("12px");
      expect(geometry.nameOpacity).toBe("1");
      expect(geometry.nameFilter).toBe("none");
      expect(geometry.stackOpacity).toBe("1");
      expect(geometry.stackFilter).toBe("none");
    }
    await foldingPage.screenshot({ path:testInfo.outputPath("fold-overlay-centered-390x660.png") });
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
