import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  listeners = new Map<string, Array<(event: any) => void>>();
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() { this.readyState = 3; }
  send() {}
  emit(type: string, event: any = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

describe("room transient lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key))
    };
    Object.assign(globalThis, {
      localStorage,
      window:{
        location:{ protocol:"http:", host:"localhost" },
        sessionStorage:{ setItem:vi.fn(), removeItem:vi.fn() },
        localStorage,
        clearTimeout,
        setTimeout
      },
      WebSocket:FakeWebSocket
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("preserves transients for same-room reconnect but clears them when switching rooms", async () => {
    const { useGameStore } = await import("../src/store/gameStore");
    const { useRoomStore } = await import("../src/store/roomStore");
    useGameStore.getState().receiveEmoji({ id:"expression", kind:"expression", emoji:"😂", from:"seat-0", createdAt:1 });
    useGameStore.getState().receiveChatBubble("chat", "hello", "user", "seat-0", 2);

    useRoomStore.getState().connect("AAAAAA");
    expect(useGameStore.getState().emojiOverlays).toHaveLength(1);
    expect(useGameStore.getState().chatBubbles).toHaveLength(1);
    useRoomStore.getState().connect("AAAAAA");
    expect(useGameStore.getState().emojiOverlays).toHaveLength(1);

    useRoomStore.getState().connect("BBBBBB");
    expect(useGameStore.getState()).toMatchObject({ emojiBursts:[], emojiOverlays:[], chatBubbles:[] });
  });

  it("clears transients on explicit disconnect and every socket close", async () => {
    const { useGameStore } = await import("../src/store/gameStore");
    const { useRoomStore } = await import("../src/store/roomStore");
    const seed = () => {
      useGameStore.getState().receiveEmoji({ id:`expression-${Date.now()}`, kind:"expression", emoji:"😂", from:"seat-0", createdAt:Date.now() });
      useGameStore.getState().receiveChatBubble(`chat-${Date.now()}`, "hello", "user", "seat-0", Date.now());
    };

    seed();
    useRoomStore.getState().connect("CCCCCC");
    useRoomStore.getState().disconnect();
    expect(useGameStore.getState()).toMatchObject({ emojiBursts:[], emojiOverlays:[], chatBubbles:[] });

    seed();
    useRoomStore.getState().connect("DDDDDD");
    FakeWebSocket.instances.at(-1)!.emit("close", { code:1008 });
    expect(useGameStore.getState()).toMatchObject({ emojiBursts:[], emojiOverlays:[], chatBubbles:[] });

    seed();
    useRoomStore.getState().connect("EEEEEE");
    FakeWebSocket.instances.at(-1)!.emit("close", { code:1006 });
    expect(useGameStore.getState()).toMatchObject({ emojiBursts:[], emojiOverlays:[], chatBubbles:[] });
  });

  it("clears transients when the room is dissolved", async () => {
    const { useGameStore } = await import("../src/store/gameStore");
    const { useRoomStore } = await import("../src/store/roomStore");
    useGameStore.getState().receiveEmoji({ id:"expression-dissolved", kind:"expression", emoji:"😂", from:"seat-0", createdAt:1 });
    useGameStore.getState().receiveChatBubble("chat-dissolved", "hello", "user", "seat-0", 2);
    useRoomStore.getState().connect("FFFFFF");

    FakeWebSocket.instances.at(-1)!.emit("message", {
      data:JSON.stringify({ type:"dissolved", message:"room dissolved" })
    });

    expect(useGameStore.getState()).toMatchObject({ emojiBursts:[], emojiOverlays:[], chatBubbles:[] });
  });

  it("does not clear transients on an ordinary room broadcast", async () => {
    const { useGameStore } = await import("../src/store/gameStore");
    const { useRoomStore } = await import("../src/store/roomStore");
    useGameStore.getState().receiveEmoji({ id:"expression-room", kind:"expression", emoji:"😎", from:"seat-0", createdAt:1 });
    useRoomStore.getState().connect("GGGGGG");
    FakeWebSocket.instances.at(-1)!.emit("message", { data:JSON.stringify({ type:"room", room:{ code:"GGGGGG" } }) });
    expect(useGameStore.getState().emojiOverlays).toHaveLength(1);
  });
});
