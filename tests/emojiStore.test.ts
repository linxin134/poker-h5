import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "../src/store/gameStore";

describe("multiplayer emoji bursts", () => {
  beforeEach(() => {
    for (const burst of useGameStore.getState().emojiBursts) {
      useGameStore.getState().clearEmoji(burst.id);
    }
  });

  it("deduplicates server event ids and bounds concurrent transient effects", () => {
    const store = useGameStore.getState();
    store.receiveEmoji("same-event", "🌹", "seat-a", "seat-b");
    store.receiveEmoji("same-event", "🌹", "seat-a", "seat-b");
    for (let index = 0; index < 9; index += 1) {
      store.receiveEmoji(`event-${index}`, "👏", "seat-a", "seat-b");
    }

    const bursts = useGameStore.getState().emojiBursts;
    expect(bursts).toHaveLength(6);
    expect(new Set(bursts.map((burst) => burst.id)).size).toBe(6);
    expect(bursts.at(-1)?.id).toBe("event-8");
  });
});
