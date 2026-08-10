import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";

const setup = () => startHand(createInitialState([
  { id: "a", name: "A", avatar: "A", stack: 1000, isHuman: true },
  { id: "b", name: "B", avatar: "B", stack: 1000, isHuman: false },
  { id: "c", name: "C", avatar: "C", stack: 1000, isHuman: false }
], 10, 20), () => .42);

describe("game engine", () => {
  it("发牌并发布合法行动", () => {
    const state = setup();
    expect(state.seats.every((seat) => seat.holeCards.length === 2)).toBe(true);
    expect(legalActions(state).actions).toContain("call");
  });

  it("其余玩家弃牌后立即结算", () => {
    let state = setup();
    state = applyAction(state, state.seats[state.actorIndex].id, "fold");
    state = applyAction(state, state.seats[state.actorIndex].id, "fold");
    expect(state.phase).toBe("complete");
    expect(state.winnerText).toContain("赢得");
    expect(state.result?.pot).toBe(30);
    expect(state.result?.winnerSeatIds).toHaveLength(1);
  });
});
