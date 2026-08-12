import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { RoomClientMessage, RoomView } from "../src/multiplayer/types";

const origin = "http://127.0.0.1:5173";

type HarnessState = {
  socket: WebSocket;
  room: RoomView | null;
  errors: string[];
  revision: number;
};

async function openSocket(page: Page, code: string) {
  await page.goto(origin);
  await page.evaluate((roomCode) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/rooms/${roomCode}/socket`);
    const state: HarnessState = { socket, room: null, errors: [], revision: 0 };
    (window as typeof window & { __pokerHarness?: HarnessState }).__pokerHarness = state;
    const timeout = window.setTimeout(() => reject(new Error("WebSocket room state timeout")), 5_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; room?: RoomView; message?: string };
      if (message.type === "room" && message.room) {
        state.room = message.room;
        state.revision += 1;
        window.clearTimeout(timeout);
        resolve();
      }
      if (message.type === "error" && message.message) state.errors.push(message.message);
    };
    socket.onerror = () => reject(new Error("WebSocket connection failed"));
  }), code);
}

async function closeSocket(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const state = (window as typeof window & { __pokerHarness?: HarnessState }).__pokerHarness;
    if (!state || state.socket.readyState >= WebSocket.CLOSING) return resolve();
    state.socket.addEventListener("close", () => resolve(), { once: true });
    state.socket.close();
  }));
}

async function send(page: Page, message: RoomClientMessage) {
  await page.evaluate((payload) => {
    const state = (window as typeof window & { __pokerHarness?: HarnessState }).__pokerHarness;
    if (!state || state.socket.readyState !== WebSocket.OPEN) throw new Error("test socket is not open");
    state.socket.send(JSON.stringify(payload));
  }, message);
}

async function roomOf(page: Page): Promise<RoomView> {
  const room = await page.evaluate(() => (window as typeof window & { __pokerHarness?: HarnessState }).__pokerHarness?.room ?? null);
  if (!room) throw new Error("room state is unavailable");
  return room;
}

async function revisionOf(page: Page) {
  return page.evaluate(() => (window as typeof window & { __pokerHarness?: HarnessState }).__pokerHarness?.revision ?? 0);
}

async function errorsOf(page: Page) {
  return page.evaluate(() => [...((window as typeof window & { __pokerHarness?: HarnessState }).__pokerHarness?.errors ?? [])]);
}

async function waitForRoom(page: Page, predicate: (room: RoomView) => boolean, timeout = 10_000) {
  await expect.poll(async () => predicate(await roomOf(page)), { timeout }).toBe(true);
}

async function expectErrorAfter(page: Page, previousCount: number, text: string) {
  await expect.poll(async () => (await errorsOf(page)).slice(previousCount).some((message) => message.includes(text))).toBe(true);
}

async function sendAndWait(observer: Page, actor: Page, message: RoomClientMessage) {
  const revision = await revisionOf(observer);
  await send(actor, message);
  await expect.poll(() => revisionOf(observer)).toBeGreaterThan(revision);
}

async function register(context: BrowserContext, stamp: string, index: number) {
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data: {
      email: `complex-${index}-${stamp}@local.test`,
      password: "test-pass-123",
      nickname: `C${stamp.slice(-8)}-${index}`
    }
  });
  expect(response.ok()).toBe(true);
  return (await response.json() as { user: { id: string; nickname: string } }).user;
}

test("six-player authoritative battle keeps perspectives, side pots and cumulative scores correct", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile H5 authoritative multiplayer coverage");
  test.setTimeout(180_000);
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  const contexts: BrowserContext[] = [page.context()];
  const pages: Page[] = [page];

  try {
    for (let index = 1; index < 6; index += 1) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      contexts.push(context);
      pages.push(await context.newPage());
    }

    const users: Array<{ id: string; nickname: string }> = [];
    for (let index = 0; index < contexts.length; index += 1) users.push(await register(contexts[index], stamp, index));

    const createResponse = await contexts[0].request.post(`${origin}/api/rooms`, {
      data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 }
    });
    expect(createResponse.ok()).toBe(true);
    const { code } = await createResponse.json() as { code: string };
    for (const context of contexts.slice(1)) {
      expect((await context.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    }
    for (const socketPage of pages) await openSocket(socketPage, code);

    await sendAndWait(pages[0], pages[0], { type: "sit", seatIndex: 0 });
    const occupiedErrorCount = (await errorsOf(pages[1])).length;
    await send(pages[1], { type: "sit", seatIndex: 0 });
    await expectErrorAfter(pages[1], occupiedErrorCount, "已经有人");
    for (let index = 1; index < pages.length; index += 1) {
      await sendAndWait(pages[0], pages[index], { type: "sit", seatIndex: index });
    }
    await waitForRoom(pages[0], (room) => room.members.filter((member) => member.seatIndex !== null).length === 6);

    const nonHostStartErrors = (await errorsOf(pages[1])).length;
    await send(pages[1], { type: "start" });
    await expectErrorAfter(pages[1], nonHostStartErrors, "只有房主");
    await sendAndWait(pages[1], pages[0], { type: "start" });
    await waitForRoom(pages[0], (room) => room.status === "playing" && room.game?.handNumber === 1);

    const initialViews = await Promise.all(pages.map(roomOf));
    const commonHandId = initialViews[0].game!.handId;
    for (let index = 0; index < initialViews.length; index += 1) {
      const view = initialViews[index];
      expect(view.game!.handId).toBe(commonHandId);
      expect(view.game!.board).toEqual([]);
      expect(view.game!.seats).toHaveLength(6);
      const ownSeat = view.game!.seats.find((seat) => seat.userId === users[index].id)!;
      expect(ownSeat.holeCards).toHaveLength(2);
      expect(ownSeat.shownHoleCards?.filter(Boolean)).toHaveLength(2);
      for (const other of view.game!.seats.filter((seat) => seat.userId !== users[index].id)) {
        expect(other.holeCards).toEqual([]);
        expect(other.shownHoleCards).toEqual([null, null]);
      }
    }

    const actorUserId = initialViews[0].game!.seats[initialViews[0].game!.actorIndex].userId!;
    const actorPageIndex = users.findIndex((user) => user.id === actorUserId);
    const wrongActorIndex = (actorPageIndex + 1) % pages.length;
    const wrongActorErrors = (await errorsOf(pages[wrongActorIndex])).length;
    await send(pages[wrongActorIndex], { type: "action", action: "fold" });
    await expectErrorAfter(pages[wrongActorIndex], wrongActorErrors, "还没轮到你");

    const revealBeforeFoldErrors = (await errorsOf(pages[actorPageIndex])).length;
    await send(pages[actorPageIndex], { type: "revealCard", cardIndex: 0 });
    await expectErrorAfter(pages[actorPageIndex], revealBeforeFoldErrors, "只有弃牌后");

    await sendAndWait(pages[wrongActorIndex], pages[actorPageIndex], { type: "action", action: "fold" });
    await waitForRoom(pages[wrongActorIndex], (room) => room.game!.seats.some((seat) => seat.userId === actorUserId && seat.folded));
    await sendAndWait(pages[wrongActorIndex], pages[actorPageIndex], { type: "revealCard", cardIndex: 0 });
    const observerView = await roomOf(pages[wrongActorIndex]);
    const foldedFromObserver = observerView.game!.seats.find((seat) => seat.userId === actorUserId)!;
    expect(foldedFromObserver.shownHoleCards?.[0]).not.toBeNull();
    expect(foldedFromObserver.shownHoleCards?.[1]).toBeNull();
    const badRevealErrors = (await errorsOf(pages[actorPageIndex])).length;
    await send(pages[actorPageIndex], { type: "revealCard", cardIndex: 2 });
    await expectErrorAfter(pages[actorPageIndex], badRevealErrors, "底牌不存在");
    await sendAndWait(pages[wrongActorIndex], pages[actorPageIndex], { type: "stand" });
    await waitForRoom(pages[wrongActorIndex], (room) => room.members.some((member) => member.userId === actorUserId && member.standingNow));

    const beforeDisconnect = await roomOf(pages[0]);
    const disconnectedActor = beforeDisconnect.game!.seats[beforeDisconnect.game!.actorIndex];
    const disconnectedPageIndex = users.findIndex((user) => user.id === disconnectedActor.userId);
    const disconnectObserver = pages[(disconnectedPageIndex + 1) % pages.length];
    const beforeTimeoutSignature = `${beforeDisconnect.game!.phase}:${beforeDisconnect.game!.actorIndex}:${beforeDisconnect.game!.history.length}`;
    await closeSocket(pages[disconnectedPageIndex]);
    await expect.poll(async () => {
      const room = await roomOf(disconnectObserver);
      return `${room.game!.phase}:${room.game!.actorIndex}:${room.game!.history.length}`;
    }, { timeout: 5_000 }).not.toBe(beforeTimeoutSignature);
    await openSocket(pages[disconnectedPageIndex], code);
    await waitForRoom(pages[disconnectedPageIndex], (room) => room.game?.handId === commonHandId);

    const liveRoom = await roomOf(pages[0]);
    const liveActorUserId = liveRoom.game!.seats[liveRoom.game!.actorIndex].userId!;
    const liveActorIndex = users.findIndex((user) => user.id === liveActorUserId);
    const uiPage = await contexts[liveActorIndex].newPage();
    try {
      await uiPage.goto(origin);
      // Use the production reconnect path. The actor already belongs to the
      // room and a second join click can race the harness socket's turn timer.
      await uiPage.evaluate((roomCode) => sessionStorage.setItem("poker-active-room", roomCode), code);
      await uiPage.reload();
      if (!await uiPage.locator(".table-screen").count()) {
        const roomCard = uiPage.locator(".public-room-list article", { hasText:code });
        await roomCard.getByRole("button", { name:/加入/ }).click();
      }
      await expect(uiPage.locator(".table-screen")).toBeVisible({ timeout:10_000 });
      await expect(uiPage.locator(".hero-seat .seat-cards .playing-card:not(.card-back)")).toHaveCount(2);
      await expect(uiPage.locator(".action-dock.my-turn")).toBeVisible();
      const geometry = await uiPage.evaluate(() => {
        const boardCards = [...document.querySelectorAll<HTMLElement>(".board-cards > .playing-card")].map((element) => element.getBoundingClientRect());
        const board = {
          left: Math.min(...boardCards.map((rect) => rect.left)),
          right: Math.max(...boardCards.map((rect) => rect.right)),
          top: Math.min(...boardCards.map((rect) => rect.top)),
          bottom: Math.max(...boardCards.map((rect) => rect.bottom))
        };
        const avatars = [...document.querySelectorAll<HTMLElement>(".seat .avatar-ring")].map((element) => element.getBoundingClientRect());
        const collisions = avatars.filter((avatar) => !(avatar.right <= board.left || avatar.left >= board.right || avatar.bottom <= board.top || avatar.top >= board.bottom)).length;
        const hero = document.querySelector<HTMLElement>(".hero-seat .avatar-ring")!.getBoundingClientRect();
        const centerAction = document.querySelector<HTMLElement>(".action-buttons .action.raise")!.getBoundingClientRect();
        const playerUi = [...document.querySelectorAll<HTMLElement>(".seat .avatar-ring,.seat .seat-info b,.seat .seat-info span,.seat .seat-cards,.seat .seat-bet,.seat .dealer-button")];
        const clippedPlayerUi = playerUi.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < 0 || rect.right > window.innerWidth || rect.top < 0 || rect.bottom > window.innerHeight;
        }).length;
        return {
          collisions,
          clippedPlayerUi,
          centerActionDelta: Math.hypot((hero.left + hero.width / 2) - (centerAction.left + centerAction.width / 2), (hero.top + hero.height / 2) - (centerAction.top + centerAction.height / 2)),
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          verticalOverflow: document.documentElement.scrollHeight - window.innerHeight
        };
      });
      expect(geometry.collisions).toBe(0);
      expect(geometry.clippedPlayerUi).toBe(0);
      expect(geometry.centerActionDelta).toBeLessThanOrEqual(1);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
      expect(geometry.verticalOverflow).toBeLessThanOrEqual(1);
      await uiPage.screenshot({ path: testInfo.outputPath("complex-six-player-actor-view.png") });
    } finally {
      await uiPage.close();
    }

    for (let guard = 0; guard < 80; guard += 1) {
      const room = await roomOf(pages[0]);
      if (room.hands.some((hand) => hand.handNumber === 1) || room.game!.handNumber > 1) break;
      const actor = room.game!.seats[room.game!.actorIndex];
      const action = room.game!.currentBet - actor.bet > 0 ? "call" : "check";
      const index = users.findIndex((user) => user.id === actor.userId);
      await sendAndWait(pages[(index + 1) % pages.length], pages[index], { type: "action", action });
    }
    await waitForRoom(pages[0], (room) => room.hands.some((hand) => hand.handNumber === 1));

    const firstComplete = await roomOf(pages[0]);
    const firstHand = firstComplete.hands.find((hand) => hand.handNumber === 1)!;
    expect(firstHand.seats.reduce((sum, seat) => sum + seat.delta, 0)).toBe(0);
    expect(firstHand.seats.reduce((sum, seat) => sum + seat.finalStack, 0)).toBe(1_200);
    expect(firstHand.seats.every((seat) => seat.delta === seat.finalStack - 200)).toBe(true);
    expect(firstHand.seats.find((seat) => seat.seatId === `seat-${actorPageIndex}`)?.cards.filter(Boolean)).toHaveLength(1);
    expect(firstHand.seats.filter((seat) => seat.showedDown).every((seat) => seat.cards.filter(Boolean).length === 2 && Boolean(seat.handName))).toBe(true);
    const firstScores = firstComplete.scoreboard.map((entry) => entry.delta);
    expect(firstScores).toEqual([...firstScores].sort((a, b) => b - a));

    const topUpSeat = firstComplete.game!.seats
      .filter((seat) => seat.userId !== actorUserId)
      .sort((a, b) => a.stack - b.stack)[0];
    const topUpPageIndex = users.findIndex((user) => user.id === topUpSeat.userId);
    await send(pages[topUpPageIndex], { type: "topup", targetStack: 600 });
    const handBeforeTopUp = firstComplete.game!.handNumber;
    if (firstComplete.game!.phase !== "complete") {
      for (let guard = 0; guard < 80; guard += 1) {
        const room = await roomOf(pages[0]);
        if (room.hands.some((hand) => hand.handNumber === handBeforeTopUp)) break;
        const actor = room.game!.seats[room.game!.actorIndex];
        const action = room.game!.currentBet - actor.bet > 0 ? "call" : "check";
        const index = users.findIndex((user) => user.id === actor.userId);
        await sendAndWait(pages[(index + 1) % pages.length], pages[index], { type: "action", action });
      }
    }
    const sidePotHandNumber = handBeforeTopUp + 1;
    await waitForRoom(pages[0], (room) => room.game?.handNumber === sidePotHandNumber, 8_000);
    const secondStart = await roomOf(pages[0]);
    expect(secondStart.game!.seats).toHaveLength(5);
    expect(secondStart.members.find((member) => member.userId === actorUserId)?.seatIndex).toBeNull();
    expect(secondStart.game!.seats.find((seat) => seat.userId === topUpSeat.userId)?.stack).toBeLessThanOrEqual(600);

    let deepAllIn = false;
    for (let guard = 0; guard < 80; guard += 1) {
      const room = await roomOf(pages[0]);
      if (room.game!.phase === "complete") break;
      const actor = room.game!.seats[room.game!.actorIndex];
      const pageIndex = users.findIndex((user) => user.id === actor.userId);
      const callAmount = Math.max(0, room.game!.currentBet - actor.bet);
      let action: "check" | "call" | "all-in" = callAmount > 0 ? "call" : "check";
      if (!deepAllIn && actor.userId === topUpSeat.userId) {
        action = "all-in";
        deepAllIn = true;
      } else if (deepAllIn && callAmount >= actor.stack) {
        action = "all-in";
      }
      await sendAndWait(pages[(pageIndex + 1) % pages.length], pages[pageIndex], { type: "action", action });
    }
    await waitForRoom(pages[0], (room) => room.hands.some((hand) => hand.handNumber === sidePotHandNumber));

    const finalRoom = await roomOf(pages[0]);
    const secondHand = finalRoom.hands.find((hand) => hand.handNumber === sidePotHandNumber)!;
    const contributions = finalRoom.game!.seats.map((seat) => seat.totalContribution).filter((value) => value > 0);
    expect(new Set(contributions).size).toBeGreaterThan(1);
    expect(contributions.reduce((sum, value) => sum + value, 0)).toBe(finalRoom.game!.result!.pot);
    expect(secondHand.seats.reduce((sum, seat) => sum + seat.delta, 0)).toBe(0);
    expect(secondHand.pot).toBe(finalRoom.game!.result!.pot);
    const sortedDeltas = finalRoom.scoreboard.map((entry) => entry.delta);
    expect(sortedDeltas).toEqual([...sortedDeltas].sort((a, b) => b - a));

    const savedSpectatorStack = finalRoom.members
      .filter((member) => member.seatIndex === null)
      .reduce((sum, member) => sum + (member.savedStack ?? 0), 0);
    const roomHoldings = finalRoom.game!.seats.reduce((sum, seat) => sum + seat.stack, 0) + savedSpectatorStack;
    const totalBuyIn = finalRoom.members.reduce((sum, member) => sum + member.buyIn, 0);
    expect(roomHoldings).toBe(totalBuyIn);
    const allMemberDelta = finalRoom.scoreboard.reduce((sum, entry) => sum + entry.delta, 0)
      + finalRoom.members.filter((member) => member.seatIndex === null).reduce((sum, member) => sum + (member.savedStack ?? 0) - member.buyIn, 0);
    expect(allMemberDelta).toBe(0);

    const stats = [];
    for (const context of contexts) stats.push(await (await context.request.get(`${origin}/api/stats`)).json() as { hands: number; profit: number });
    expect(stats.reduce((sum, entry) => sum + entry.profit, 0)).toBe(0);
    const recordedPlayerHands = finalRoom.hands.reduce((sum, hand) => sum + hand.seats.length, 0);
    expect(stats.reduce((sum, entry) => sum + entry.hands, 0)).toBe(recordedPlayerHands);
  } finally {
    await Promise.all(pages.map((socketPage) => closeSocket(socketPage).catch(() => undefined)));
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
