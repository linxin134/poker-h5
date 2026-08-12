import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RoomClientMessage, RoomView } from "../src/multiplayer/types";

const origin = "http://127.0.0.1:5173";

type Harness = { socket: WebSocket; room: RoomView | null; errors: string[] };

async function register(context: BrowserContext, stamp: string, index: number) {
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data: { email: `heads-up-${index}-${stamp}@local.test`, password: "test-pass-123", nickname: `单挑${index}` }
  });
  expect(response.ok()).toBe(true);
}

async function openSocket(page: Page, code: string) {
  await page.goto(origin);
  await page.evaluate((roomCode) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/rooms/${roomCode}/socket`);
    const state: Harness = { socket, room: null, errors: [] };
    (window as typeof window & { __headsUp?: Harness }).__headsUp = state;
    const timer = window.setTimeout(() => reject(new Error("room socket timeout")), 5_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; room?: RoomView; message?: string };
      if (message.type === "room" && message.room) {
        state.room = message.room;
        window.clearTimeout(timer);
        resolve();
      }
      if (message.type === "error" && message.message) state.errors.push(message.message);
    };
    socket.onerror = () => reject(new Error("room socket failed"));
  }), code);
}

async function send(page: Page, message: RoomClientMessage) {
  await page.evaluate((payload) => {
    const state = (window as typeof window & { __headsUp?: Harness }).__headsUp;
    if (!state || state.socket.readyState !== WebSocket.OPEN) throw new Error("socket not open");
    state.socket.send(JSON.stringify(payload));
  }, message);
}

async function roomOf(page: Page) {
  const room = await page.evaluate(() => (window as typeof window & { __headsUp?: Harness }).__headsUp?.room ?? null);
  if (!room) throw new Error("room unavailable");
  return room;
}

async function errorsOf(page: Page) {
  return page.evaluate(() => [...((window as typeof window & { __headsUp?: Harness }).__headsUp?.errors ?? [])]);
}

test("one player is blocked and two seated players can start a heads-up game", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile authoritative heads-up coverage");
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 660 } });
  const guestPage = await guestContext.newPage();

  try {
    const stamp = `${Date.now()}-${testInfo.workerIndex}`;
    await register(page.context(), stamp, 0);
    await register(guestContext, stamp, 1);
    const created = await page.context().request.post(`${origin}/api/rooms`, {
      data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 }
    });
    const { code } = await created.json() as { code: string };
    expect((await guestContext.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    await openSocket(page, code);
    await openSocket(guestPage, code);

    await send(page, { type: "sit", seatIndex: 0 });
    await expect.poll(async () => (await roomOf(page)).members.filter((member) => member.seatIndex !== null).length).toBe(1);
    const beforeErrors = (await errorsOf(page)).length;
    await send(page, { type: "start" });
    await expect.poll(async () => (await errorsOf(page)).slice(beforeErrors).some((message) => message.includes("两名"))).toBe(true);
    expect((await roomOf(page)).status).toBe("waiting");

    await send(guestPage, { type: "sit", seatIndex: 4 });
    await expect.poll(async () => (await roomOf(page)).members.filter((member) => member.seatIndex !== null).length).toBe(2);
    await send(page, { type: "start" });
    await expect.poll(async () => (await roomOf(page)).status).toBe("playing");
    const started = await roomOf(page);
    expect(started.game?.seats).toHaveLength(2);
    expect(started.game?.handNumber).toBe(1);
  } finally {
    await guestContext.close();
  }
});
