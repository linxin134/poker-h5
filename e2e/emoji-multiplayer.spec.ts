import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RoomClientMessage, RoomServerMessage, RoomView } from "../src/multiplayer/types";

const origin = "http://127.0.0.1:5173";

type EmojiHarness = { socket: WebSocket; room: RoomView | null; messages: RoomServerMessage[] };

async function register(context: BrowserContext, stamp: string, name: string) {
  const slug = name === "表情发送者" ? "emoji-sender" : "emoji-receiver";
  const response = await context.request.post(`${origin}/api/auth/register`, { data: { email: `${slug}-${stamp}@local.test`, password: "test-pass-123", nickname: name } });
  expect(response.ok()).toBe(true);
}

async function connect(page: Page, code: string) {
  await page.goto(origin);
  await page.evaluate((roomCode) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/rooms/${roomCode}/socket`);
    const state: EmojiHarness = { socket, room: null, messages: [] };
    (window as typeof window & { __emojiHarness?: EmojiHarness }).__emojiHarness = state;
    const timeout = window.setTimeout(() => reject(new Error("room state timeout")), 5_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as RoomServerMessage;
      state.messages.push(message);
      if (message.type === "room") {
        state.room = message.room;
        window.clearTimeout(timeout);
        resolve();
      }
    };
    socket.onerror = () => reject(new Error("socket failed"));
  }), code);
}

async function send(page: Page, message: RoomClientMessage) {
  await page.evaluate((payload) => {
    (window as typeof window & { __emojiHarness: EmojiHarness }).__emojiHarness.socket.send(JSON.stringify(payload));
  }, message);
}

async function room(page: Page) {
  return page.evaluate(() => (window as typeof window & { __emojiHarness: EmojiHarness }).__emojiHarness.room!);
}

async function messages(page: Page) {
  return page.evaluate(() => (window as typeof window & { __emojiHarness: EmojiHarness }).__emojiHarness.messages);
}

test("server validates and broadcasts transient avatar interactions without reconnect replay", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile multiplayer interaction coverage");
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  const receiverContext = await browser.newContext({ viewport: { width: 390, height: 660 } });
  const receiver = await receiverContext.newPage();
  try {
    await register(page.context(), stamp, "表情发送者");
    await register(receiverContext, stamp, "表情接收者");
    const createResponse = await page.context().request.post(`${origin}/api/rooms`, { data: { durationMinutes: 30, capacity: 3, startingStack: 200, smallBlind: 1, bigBlind: 2 } });
    const { code } = await createResponse.json() as { code: string };
    expect((await receiverContext.request.post(`${origin}/api/rooms/${code}/join`)).ok()).toBe(true);
    await connect(page, code);
    await connect(receiver, code);
    await send(page, { type: "sit", seatIndex: 0 });
    await send(receiver, { type: "sit", seatIndex: 2 });
    await expect.poll(async () => (await room(page)).members.filter((member) => member.seatIndex !== null).length).toBe(2);

    const senderSeatId = (await room(page)).mySeatId;
    const receiverSeatId = (await room(receiver)).mySeatId;
    expect(senderSeatId).toBeTruthy();
    expect(receiverSeatId).toBeTruthy();

    await send(page, { type: "emoji", emoji: "🌹", targetSeatId: senderSeatId });
    await expect.poll(async () => (await messages(page)).some((message) => message.type === "error" && message.message.includes("不能向自己"))).toBe(true);
    await send(page, { type: "emoji", emoji: "🌹", targetSeatId: "missing-seat" });
    await expect.poll(async () => (await messages(page)).some((message) => message.type === "error" && message.message.includes("目标已离开"))).toBe(true);

    await send(page, { type: "emoji", emoji: "🌹", targetSeatId: receiverSeatId });
    await expect.poll(async () => (await messages(receiver)).filter((message) => message.type === "emoji").length).toBe(1);
    const senderEvent = (await messages(page)).find((message) => message.type === "emoji");
    const receiverEvent = (await messages(receiver)).find((message) => message.type === "emoji");
    expect(receiverEvent).toEqual(senderEvent);
    expect(receiverEvent).toMatchObject({ type: "emoji", emoji: "🌹", fromSeatId: senderSeatId, targetSeatId: receiverSeatId });

    await receiver.evaluate(() => (window as typeof window & { __emojiHarness: EmojiHarness }).__emojiHarness.socket.close());
    await connect(receiver, code);
    await receiver.waitForTimeout(750);
    expect((await messages(receiver)).filter((message) => message.type === "emoji")).toHaveLength(0);
  } finally {
    await receiverContext.close();
  }
});
