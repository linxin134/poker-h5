import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "../src/store/gameStore";

describe("multiplayer emoji bursts", () => {
  beforeEach(() => {
    for (const burst of useGameStore.getState().emojiBursts) {
      useGameStore.getState().clearEmoji(burst.id);
    }
    for (const overlay of useGameStore.getState().emojiOverlays) {
      useGameStore.getState().clearEmoji(overlay.id);
    }
  });

  it("deduplicates server event ids and bounds concurrent transient effects", () => {
    const store = useGameStore.getState();
    store.receiveEmoji({ id:"same-event", kind:"interaction", emoji:"🌹", from:"seat-a", to:"seat-b", createdAt:1 });
    store.receiveEmoji({ id:"same-event", kind:"interaction", emoji:"🌹", from:"seat-a", to:"seat-b", createdAt:1 });
    for (let index = 0; index < 9; index += 1) {
      store.receiveEmoji({ id:`event-${index}`, kind:"interaction", emoji:"👏", from:"seat-a", to:"seat-b", createdAt:index });
    }

    const bursts = useGameStore.getState().emojiBursts;
    expect(bursts).toHaveLength(6);
    expect(new Set(bursts.map((burst) => burst.id)).size).toBe(6);
    expect(bursts.at(-1)?.id).toBe("event-8");
  });

  it("keeps non-targeted expressions separate and replaces the same sender overlay", () => {
    const store = useGameStore.getState();
    store.receiveEmoji({ id:"expression-a", kind:"expression", emoji:"😂", from:"seat-a", createdAt:10 });
    store.receiveEmoji({ id:"expression-b", kind:"expression", emoji:"😎", from:"seat-a", createdAt:20 });
    store.receiveEmoji({ id:"interaction-c", kind:"interaction", emoji:"🌹", from:"seat-a", to:"seat-b", createdAt:30 });

    expect(useGameStore.getState().emojiOverlays).toEqual([{ id:"expression-b", kind:"expression", emoji:"😎", from:"seat-a", createdAt:20 }]);
    expect(useGameStore.getState().emojiBursts.at(-1)).toMatchObject({ id:"interaction-c", kind:"interaction", to:"seat-b" });
  });

  it("atomically clears every seat-keyed transient when leaving a room boundary", () => {
    const store = useGameStore.getState();
    store.receiveEmoji({ id:"expression", kind:"expression", emoji:"😂", from:"seat-0", createdAt:10 });
    store.receiveEmoji({ id:"interaction", kind:"interaction", emoji:"🌹", from:"seat-0", to:"seat-1", createdAt:20 });
    store.receiveChatBubble("chat", "hello", "user-0", "seat-0", 30);

    expect(useGameStore.getState()).toMatchObject({
      emojiBursts:[expect.objectContaining({ id:"interaction" })],
      emojiOverlays:[expect.objectContaining({ id:"expression" })],
      chatBubbles:[expect.objectContaining({ id:"chat" })]
    });
    store.clearTransientUi();
    expect(useGameStore.getState()).toMatchObject({ emojiBursts:[], emojiOverlays:[], chatBubbles:[] });
  });
});
