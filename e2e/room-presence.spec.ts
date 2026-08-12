import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RoomClientMessage, RoomView } from "../src/multiplayer/types";

const origin = "http://127.0.0.1:5173";

type Harness = { socket: WebSocket; room: RoomView | null; revision: number };

async function register(context: BrowserContext, stamp: string, index: number) {
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data: { email: `presence-${index}-${stamp}@local.test`, password: "test-pass-123", nickname: `P${index}-${stamp.slice(-5)}` }
  });
  expect(response.ok()).toBe(true);
  return (await response.json() as { user: { id: string } }).user;
}

async function openSocket(page: Page, code: string) {
  await page.goto(origin);
  await page.evaluate((roomCode) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/rooms/${roomCode}/socket`);
    const state: Harness = { socket, room: null, revision: 0 };
    (window as typeof window & { __presence?: Harness }).__presence = state;
    const timer = window.setTimeout(() => reject(new Error("room socket timeout")), 5_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; room?: RoomView };
      if (message.type === "room" && message.room) {
        state.room = message.room;
        state.revision += 1;
        window.clearTimeout(timer);
        resolve();
      }
    };
    socket.onerror = () => reject(new Error("room socket failed"));
  }), code);
}

async function roomOf(page: Page) {
  const room = await page.evaluate(() => (window as typeof window & { __presence?: Harness }).__presence?.room ?? null);
  if (!room) throw new Error("room unavailable");
  return room;
}

async function send(page: Page, message: RoomClientMessage) {
  await page.evaluate((payload) => {
    const state = (window as typeof window & { __presence?: Harness }).__presence;
    if (!state || state.socket.readyState !== WebSocket.OPEN) throw new Error("socket not open");
    state.socket.send(JSON.stringify(payload));
  }, message);
}

async function closeSocket(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const socket = (window as typeof window & { __presence?: Harness }).__presence?.socket;
    if (!socket || socket.readyState >= WebSocket.CLOSING) return resolve();
    socket.addEventListener("close", () => resolve(), { once: true });
    socket.close();
  }));
}

test("leaving updates room count immediately and offline players stand before the next hand", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile authoritative room presence coverage");
  test.setTimeout(60_000);
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  const contexts = [page.context(), await browser.newContext(), await browser.newContext()];
  const pages = [page, await contexts[1].newPage(), await contexts[2].newPage()];

  try {
    const users: Array<{ id: string }> = [];
    for (let index = 0; index < contexts.length; index += 1) users.push(await register(contexts[index], stamp, index));
    const created = await contexts[0].request.post(`${origin}/api/rooms`, {
      data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 }
    });
    const { code } = await created.json() as { code: string };
    for (const context of contexts.slice(1)) expect((await context.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    for (const socketPage of pages) await openSocket(socketPage, code);
    for (let index = 0; index < pages.length; index += 1) await send(pages[index], { type: "sit", seatIndex: index });
    await expect.poll(async () => (await roomOf(pages[0])).members.filter((member) => member.seatIndex !== null).length).toBe(3);
    await send(pages[0], { type: "start" });
    await expect.poll(async () => (await roomOf(pages[0])).game?.handNumber).toBe(1);

    const initial = await roomOf(pages[0]);
    const actorUserId = initial.game!.seats[initial.game!.actorIndex].userId!;
    const offlineIndex = users.findIndex((user) => user.id !== actorUserId && user.id !== users[0].id);
    await closeSocket(pages[offlineIndex]);
    await expect.poll(async () => (await roomOf(pages[0])).members.find((member) => member.userId === users[offlineIndex].id)?.connected).toBe(false);

    for (let guard = 0; guard < 12; guard += 1) {
      const room = await roomOf(pages[0]);
      if (room.game?.phase === "complete") break;
      const actor = room.game!.seats[room.game!.actorIndex];
      const actorIndex = users.findIndex((user) => user.id === actor.userId);
      if (actorIndex === offlineIndex) {
        const signature = `${room.game!.phase}:${room.game!.actorIndex}:${room.game!.history.length}`;
        await expect.poll(async () => {
          const latest = await roomOf(pages[0]);
          return `${latest.game!.phase}:${latest.game!.actorIndex}:${latest.game!.history.length}`;
        }, { timeout: 5_000 }).not.toBe(signature);
      } else {
        await send(pages[actorIndex], { type: "action", action: "fold" });
        await expect.poll(async () => (await roomOf(pages[0])).game!.history.length).toBeGreaterThan(room.game!.history.length);
      }
    }
    await expect.poll(async () => (await roomOf(pages[0])).game?.phase, { timeout: 10_000 }).toBe("complete");
    await expect.poll(async () => (await roomOf(pages[0])).game?.handNumber, { timeout: 10_000 }).toBe(2);
    const secondHand = await roomOf(pages[0]);
    expect(secondHand.members.find((member) => member.userId === users[offlineIndex].id)?.seatIndex).toBeNull();
    expect(secondHand.game!.seats.some((seat) => seat.userId === users[offlineIndex].id)).toBe(false);

    const departingIndex = users.findIndex((user, index) => index !== offlineIndex && user.id !== users[0].id);
    const beforeCount = secondHand.members.length;
    await send(pages[departingIndex], { type: "leave" });
    await expect.poll(async () => (await roomOf(pages[0])).members.length).toBe(beforeCount - 1);
    const listed = await (await contexts[0].request.get(`${origin}/api/rooms`)).json() as { rooms: Array<{ code: string; memberCount: number }> };
    expect(listed.rooms.find((room) => room.code === code)?.memberCount).toBe(1);
  } finally {
    await Promise.all(pages.map((socketPage) => closeSocket(socketPage).catch(() => undefined)));
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});
