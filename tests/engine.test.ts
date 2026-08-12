import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import type { Card, PlayerAction, PokerState } from "../src/game/types";

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
    expect(state.result?.pot).toBe(20);
    expect(state.result?.winnerSeatIds).toHaveLength(1);
  });

  it("退回无人跟注的加注部分且底池只记录实际争夺筹码", () => {
    let state = setup();
    state = applyAction(state, "a", "raise", 100);
    state = applyAction(state, "b", "fold");
    state = applyAction(state, "c", "fold");
    expect(state.phase).toBe("complete");
    expect(state.result?.pot).toBe(50);
    expect(state.seats[0].stack).toBe(1030);
    expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(3000);
    expect(state.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "uncalled-return", seatId: "a", amount: 80 })
    ]));
  });

  it("三人桌正确轮转庄位、盲注和翻牌前行动位", () => {
    const state = setup();
    expect(state.dealerIndex).toBe(0);
    expect(state.seats[1].bet).toBe(10);
    expect(state.seats[2].bet).toBe(20);
    expect(state.actorIndex).toBe(0);
    expect(state.seats.reduce((sum, seat) => sum + seat.stack + seat.bet, 0)).toBe(3000);
  });

  it("两人桌由庄家下小盲且翻牌后大盲先行动", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "A", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "B", stack: 1000, isHuman: true }
    ], 10, 20), () => .31);
    expect(state.dealerIndex).toBe(0);
    expect(state.seats[0].bet).toBe(10);
    expect(state.seats[1].bet).toBe(20);
    expect(state.actorIndex).toBe(0);
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    expect(state.phase).toBe("flop");
    expect(state.actorIndex).toBe(1);
    expect(state.board).toHaveLength(3);
    expect(state.deck).toHaveLength(44);
  });

  it("完整过牌到摊牌会烧三张牌且筹码守恒", () => {
    let state = setup();
    let guard = 0;
    while (state.phase !== "complete" && guard < 30) {
      const legal = legalActions(state);
      state = applyAction(state, state.seats[state.actorIndex].id, legal.actions.includes("check") ? "check" : "call");
      guard += 1;
    }
    expect(guard).toBeLessThan(30);
    expect(state.phase).toBe("complete");
    expect(state.board).toHaveLength(5);
    expect(state.deck).toHaveLength(38);
    expect(state.result?.reason).toBe("showdown");
    expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(3000);
  });

  it("下盲后全员已全下时自动发满公共牌并结算", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "A", stack: 5, isHuman: true },
      { id: "b", name: "B", avatar: "B", stack: 10, isHuman: true }
    ], 10, 20), () => .19);
    expect(state.phase).toBe("complete");
    expect(state.actorIndex).toBe(-1);
    expect(state.board).toHaveLength(5);
    expect(state.result?.pot).toBe(10);
    expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(15);
  });

  it("完整加注会重新开放行动并保持最小加注额", () => {
    let state = setup();
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "raise", 40);
    expect(state.currentBet).toBe(40);
    expect(state.minRaise).toBe(20);
    expect(state.actorIndex).toBe(0);
    expect(legalActions(state).actions).toContain("raise");
    expect(legalActions(state).minRaiseTo).toBe(60);
  });

  it("不足最小加注的短码全下不会向已行动玩家重新开放加注", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "A", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "B", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "C", stack: 25, isHuman: true }
    ], 10, 20), () => .27);
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "all-in");
    const legal = legalActions(state);
    expect(state.currentBet).toBe(25);
    expect(state.minRaise).toBe(20);
    expect(state.actorIndex).toBe(0);
    expect(legal.callAmount).toBe(5);
    expect(legal.actions).not.toContain("raise");
    expect(legal.actions).not.toContain("all-in");
  });

  it("短码只够跟注时仍允许用全下完成跟注", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "A", stack: 20, isHuman: true },
      { id: "b", name: "B", avatar: "B", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "C", stack: 1000, isHuman: true }
    ], 10, 20), () => .22);
    expect(legalActions(state).actions).toContain("all-in");
    state = applyAction(state, "a", "all-in");
    expect(state.seats[0].allIn).toBe(true);
    expect(state.seats[0].bet).toBe(20);
    expect(state.seats[0].allInAmount).toBe(20);
  });

  it("拒绝越界、非整数和非当前玩家的加注", () => {
    const state = setup();
    expect(() => applyAction(state, "a", "raise", 39)).toThrow("加注金额不合法");
    expect(() => applyAction(state, "a", "raise", 1001)).toThrow("加注金额不合法");
    expect(() => applyAction(state, "a", "raise", 40.5)).toThrow("加注金额不合法");
    expect(() => applyAction(state, "b", "call")).toThrow("当前操作不合法");
  });

  it("主池和边池分别支付给正确赢家", () => {
    let state = riverState({
      board: ["2♣", "3♦", "4♥", "8♣", "9♦"],
      pot: 700,
      actorIndex: 2,
      seats: [
        { id: "a", cards: ["A♠", "A♥"], stack: 0, contribution: 100, allIn: true },
        { id: "b", cards: ["K♠", "K♥"], stack: 0, contribution: 300, allIn: true },
        { id: "c", cards: ["Q♠", "Q♥"], stack: 1, contribution: 300 }
      ]
    });
    state = applyAction(state, "c", "check");
    expect(state.phase).toBe("complete");
    expect(state.seats.map((seat) => seat.stack)).toEqual([300, 400, 1]);
    expect(state.result?.winnerSeatIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("平分奇数底池时余数给庄家左手第一位赢家", () => {
    let state = riverState({
      board: ["A♠", "K♠", "Q♠", "J♠", "T♠"],
      pot: 15,
      actorIndex: 0,
      seats: [
        { id: "a", cards: ["2♣", "3♦"], stack: 10, contribution: 5 },
        { id: "b", cards: ["4♣", "5♦"], stack: 0, contribution: 5, allIn: true },
        { id: "c", cards: ["6♣", "7♦"], stack: 0, contribution: 5, folded: true, allIn: true }
      ]
    });
    state = applyAction(state, "a", "check");
    expect(state.seats[0].stack).toBe(17);
    expect(state.seats[1].stack).toBe(8);
  });

  it("多手随机合法行动下不会死循环、负筹码或破坏筹码守恒", () => {
    let seed = 17;
    const random = () => ((seed = seed * 48271 % 2147483647) / 2147483647);
    let state = createInitialState(Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, avatar: "", stack: 5000, isHuman: true })), 5, 10);
    const total = 30_000;
    let hands = 0;
    while (hands < 30 && state.seats.filter((seat) => seat.stack > 0).length >= 2) {
      state = startHand(state, random);
      const cards = [...state.deck, ...state.seats.flatMap((seat) => seat.holeCards)];
      expect(new Set(cards).size).toBe(cards.length);
      let actions = 0;
      while (state.phase !== "complete" && actions < 200) {
        const legal = legalActions(state);
        const actor = state.seats[state.actorIndex];
        let action: PlayerAction = legal.actions.includes("check") ? "check" : "call";
        if (legal.actions.includes("raise") && random() < .12) action = "raise";
        else if (legal.actions.includes("fold") && random() < .05) action = "fold";
        const raiseTo = action === "raise" ? legal.minRaiseTo : undefined;
        state = applyAction(state, actor.id, action, raiseTo);
        expect(state.seats.every((seat) => seat.stack >= 0 && seat.bet >= 0)).toBe(true);
        expect(state.seats.reduce((sum, seat) => sum + seat.stack + seat.bet, 0) + state.pot).toBe(total);
        actions += 1;
      }
      expect(actions).toBeLessThan(200);
      expect(state.phase).toBe("complete");
      hands += 1;
    }
    expect(hands).toBe(30);
  });
});

function riverState({ board, pot, actorIndex, seats }: {
  board: Card[];
  pot: number;
  actorIndex: number;
  seats: Array<{ id: string; cards: [Card, Card]; stack: number; contribution: number; folded?: boolean; allIn?: boolean }>;
}): PokerState {
  const state = createInitialState(seats.map((seat) => ({ id: seat.id, name: seat.id.toUpperCase(), avatar: "", stack: seat.stack, isHuman: true })), 1, 2);
  state.phase = "river";
  state.dealerIndex = 0;
  state.actorIndex = actorIndex;
  state.board = board;
  state.deck = [];
  state.pot = pot;
  state.currentBet = 0;
  state.minRaise = 2;
  state.actedThisRound = [];
  state.seats.forEach((seat, index) => Object.assign(seat, {
    holeCards: seats[index].cards,
    stack: seats[index].stack,
    totalContribution: seats[index].contribution,
    folded: seats[index].folded ?? false,
    allIn: seats[index].allIn ?? false,
    bet: 0
  }));
  return state;
}
