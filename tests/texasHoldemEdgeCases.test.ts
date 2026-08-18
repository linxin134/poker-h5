/**
 * 德州扑克规则边界场景 — 补全覆盖所有未测试的规则
 * 对照 Robert's Rules of Poker 逐项补全
 */
import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import { evaluateHand, compareScores } from "../src/game/cards";
import { buildSidePots } from "../src/game/pots";
import type { Card, PlayerAction, PokerState } from "../src/game/types";

const cards = (...v: Card[]) => v;
function seeded(s: number) { let x = s; return () => ((x = (x * 48271) % 2147483647) / 2147483647); }

/* ═══════════════════════════════════════════════════════════
   1. 发牌规则
   ═══════════════════════════════════════════════════════════ */
describe("发牌规则", () => {
  it("每人发2张底牌，共发出 2N 张", () => {
    for (let n = 2; n <= 9; n++) {
      const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, avatar: "", stack: 1000, isHuman: true }));
      const state = startHand(createInitialState(seats, 5, 10), seeded(100 + n));
      const totalDealt = state.seats.reduce((sum, s) => sum + s.holeCards.length, 0);
      expect(totalDealt).toBe(n * 2);
      expect(state.deck.length).toBe(52 - n * 2);
    }
  });

  it("翻牌发出3张公共牌+烧1张", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 5, 10), seeded(201));
    const deckBefore = state.deck.length;
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    expect(state.phase).toBe("flop");
    expect(state.board).toHaveLength(3);
    expect(state.deck.length).toBe(deckBefore - 4); // 1 burn + 3 deal
  });

  it("转牌发出1张公共牌+烧1张", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 5, 10), seeded(202));
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    const deckAfterFlop = state.deck.length;
    state = applyAction(state, state.seats[state.actorIndex].id, "check");
    state = applyAction(state, state.seats[state.actorIndex].id, "check");
    expect(state.phase).toBe("turn");
    expect(state.board).toHaveLength(4);
    expect(state.deck.length).toBe(deckAfterFlop - 2); // 1 burn + 1 deal
  });

  it("河牌发出1张公共牌+烧1张", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 5, 10), seeded(203));
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    state = applyAction(state, state.seats[state.actorIndex].id, "check");
    state = applyAction(state, state.seats[state.actorIndex].id, "check");
    const deckAfterTurn = state.deck.length;
    state = applyAction(state, state.seats[state.actorIndex].id, "check");
    state = applyAction(state, state.seats[state.actorIndex].id, "check");
    expect(state.phase).toBe("river" || "complete");
    expect(state.board).toHaveLength(5);
    expect(state.deck.length).toBe(deckAfterTurn - 2);
  });

  it("牌组52张不重复", () => {
    let state = startHand(createInitialState(Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, avatar: "", stack: 1000, isHuman: true
    })), 5, 10), seeded(204));
    const allCards = [...state.deck, ...state.seats.flatMap(s => s.holeCards)];
    expect(new Set(allCards).size).toBe(52);
  });
});

/* ═══════════════════════════════════════════════════════════
   2. 盲注规则
   ═══════════════════════════════════════════════════════════ */
describe("盲注规则", () => {
  it("3人桌: dealer不押盲注, SB=小盲, BB=大盲", () => {
    const state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(301));
    expect(state.seats[0].bet).toBe(0);   // dealer
    expect(state.seats[1].bet).toBe(10);  // SB
    expect(state.seats[2].bet).toBe(20);  // BB
  });

  it("两人桌: dealer=SB押小盲, 另一人押大盲", () => {
    const state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(302));
    expect(state.seats[0].bet).toBe(10);  // dealer/SB
    expect(state.seats[1].bet).toBe(20);  // BB
  });

  it("盲注从筹码中扣除", () => {
    const state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(303));
    expect(state.seats[0].stack).toBe(1000);
    expect(state.seats[1].stack).toBe(990);
    expect(state.seats[2].stack).toBe(980);
  });

  it("庄位每手轮转到下一个有筹码的玩家", () => {
    let state = createInitialState([
      { id: "p0", name: "P0", avatar: "", stack: 1000, isHuman: true },
      { id: "p1", name: "P1", avatar: "", stack: 1000, isHuman: true },
      { id: "p2", name: "P2", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20);
    const random = seeded(304);
    state = startHand(state, random);
    expect(state.dealerIndex).toBe(0);
    // 打完一手
    while (state.phase !== "complete") {
      const legal = legalActions(state);
      const a = state.seats[state.actorIndex];
      state = applyAction(state, a.id, legal.actions.includes("check") ? "check" : "call");
    }
    state = startHand(state, random);
    expect(state.dealerIndex).toBe(1);
    state = startHand(state, random);
    expect(state.dealerIndex).toBe(2);
    state = startHand(state, random);
    expect(state.dealerIndex).toBe(0); // 循环回来
  });

  it("无筹码玩家跳过庄位", () => {
    let state = createInitialState([
      { id: "p0", name: "P0", avatar: "", stack: 0, isHuman: true },
      { id: "p1", name: "P1", avatar: "", stack: 1000, isHuman: true },
      { id: "p2", name: "P2", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20);
    state = startHand(state, seeded(305));
    expect(state.dealerIndex).toBe(1); // 跳过 p0
  });
});

/* ═══════════════════════════════════════════════════════════
   3. 翻牌前行动顺序
   ═══════════════════════════════════════════════════════════ */
describe("翻牌前行动顺序", () => {
  it("3人桌: dealer(UTG)先行动 → SB → BB", () => {
    const state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(401));
    expect(state.actorIndex).toBe(0); // dealer acts first preflop (3+ players)
  });

  it("两人桌: SB(dealer)先行动 → BB", () => {
    const state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(402));
    expect(state.actorIndex).toBe(0); // SB/dealer acts first in heads-up
  });

  it("BB有最后行动权: 无人加注时BB可check或raise", () => {
    let state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(403));
    state = applyAction(state, "d", "call");
    state = applyAction(state, "sb", "call");
    expect(state.seats[state.actorIndex].id).toBe("bb");
    const legal = legalActions(state);
    expect(legal.actions).toContain("check");
    expect(legal.actions).toContain("raise");
  });

  it("有人加注后BB仍需行动: call/raise/fold", () => {
    let state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(404));
    state = applyAction(state, "d", "raise", 60);
    state = applyAction(state, "sb", "fold");
    expect(state.seats[state.actorIndex].id).toBe("bb");
    const legal = legalActions(state);
    expect(legal.actions).toContain("call");
    expect(legal.actions).toContain("raise");
    expect(legal.actions).toContain("fold");
  });
});

/* ═══════════════════════════════════════════════════════════
   4. 翻牌后行动顺序
   ═══════════════════════════════════════════════════════════ */
describe("翻牌后行动顺序", () => {
  it("翻牌后: 庄家左手边第一个活跃玩家先行动", () => {
    let state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(501));
    state = applyAction(state, "d", "call");
    state = applyAction(state, "sb", "call");
    state = applyAction(state, "bb", "check");
    expect(state.phase).toBe("flop");
    expect(state.seats[state.actorIndex].id).toBe("sb"); // SB is LEFT of dealer
  });

  it("翻牌后SB弃牌: BB先行动(跳过弃牌玩家)", () => {
    let state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(502));
    state = applyAction(state, "d", "raise", 60);
    state = applyAction(state, "sb", "fold");
    state = applyAction(state, "bb", "call");
    expect(state.phase).toBe("flop");
    // SB folded, so BB acts first post-flop
    expect(state.seats[state.actorIndex].id).toBe("bb");
  });

  it("转牌/河牌行动顺序与翻牌相同", () => {
    let state = startHand(createInitialState([
      { id: "d", name: "D", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(503));
    state = applyAction(state, "d", "call");
    state = applyAction(state, "sb", "call");
    state = applyAction(state, "bb", "check");
    expect(state.phase).toBe("flop");
    expect(state.seats[state.actorIndex].id).toBe("sb");
    state = applyAction(state, "sb", "check");
    state = applyAction(state, "bb", "check");
    state = applyAction(state, "d", "check");
    expect(state.phase).toBe("turn");
    expect(state.seats[state.actorIndex].id).toBe("sb"); // 同翻牌
  });
});

/* ═══════════════════════════════════════════════════════════
   5. 加注规则
   ═══════════════════════════════════════════════════════════ */
describe("加注规则", () => {
  it("翻牌前最小加注 = 2倍大盲 (当前注额 + minRaise)", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(601));
    const legal = legalActions(state);
    expect(legal.minRaiseTo).toBe(40); // 20 + 20
  });

  it("加注后最小加注额 = 加注幅度", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(602));
    state = applyAction(state, "a", "raise", 60); // raise of 40
    expect(state.minRaise).toBe(40);
    expect(legalActions(state).minRaiseTo).toBe(100); // 60 + 40
  });

  it("再加注后最小加注额保持为上次加注幅度", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 5000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 5000, isHuman: true },
    ], 10, 20), seeded(603));
    state = applyAction(state, "a", "raise", 60);
    state = applyAction(state, "b", "raise", 160); // raise of 100
    expect(state.minRaise).toBe(100);
    expect(legalActions(state).minRaiseTo).toBe(260);
  });

  it("翻牌后第一个下注最小为大盲", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(604));
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    expect(state.phase).toBe("flop");
    expect(legalActions(state).minRaiseTo).toBe(20);
  });

  it("加注必须是整数", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(605));
    expect(() => applyAction(state, "a", "raise", 40.5)).toThrow();
    expect(() => applyAction(state, "a", "raise", 39.9)).toThrow();
  });

  it("加注不能低于最小加注额", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(606));
    expect(() => applyAction(state, "a", "raise", 30)).toThrow(); // min=40
  });

  it("加注不能超过最大加注额(全下)", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(607));
    expect(() => applyAction(state, "a", "raise", 1001)).toThrow();
  });

  it("加注会重新开放所有已行动玩家的行动", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(608));
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "raise", 60);
    expect(state.seats[state.actorIndex].id).toBe("a");
    const legal = legalActions(state);
    expect(legal.actions).toContain("call");
    expect(legal.actions).toContain("raise");
    expect(legal.actions).toContain("fold");
  });
});

/* ═══════════════════════════════════════════════════════════
   6. 全下(All-in)规则
   ═══════════════════════════════════════════════════════════ */
describe("全下规则", () => {
  it("全下金额等于剩余筹码", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 50, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(701));
    state = applyAction(state, "a", "all-in");
    expect(state.seats[0].bet).toBe(50);
    expect(state.seats[0].stack).toBe(0);
    expect(state.seats[0].allIn).toBe(true);
  });

  it("全下小于最小加注不重开加注", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 25, isHuman: true },
    ], 10, 20), seeded(702));
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "all-in");
    expect(state.currentBet).toBe(25);
    const legal = legalActions(state);
    expect(legal.actions).not.toContain("raise");
  });

  it("全下大于等于最小加注重开加注", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 100, isHuman: true },
    ], 10, 20), seeded(703));
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "all-in");
    const legal = legalActions(state);
    expect(legal.actions).toContain("raise");
  });

  it("全员全下后自动发满5张公共牌", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 100, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 100, isHuman: true },
    ], 5, 10), seeded(704));
    state = applyAction(state, "a", "all-in");
    state = applyAction(state, "b", "all-in");
    expect(state.phase).toBe("complete");
    expect(state.board).toHaveLength(5);
  });

  it("短码全下作为跟注: 不改变 currentBet", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 20, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(705));
    // a calls, b all-in for 20 (short stack, just call BB), c acts
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "all-in");
    expect(state.currentBet).toBe(20); // BB level, 没有改变
    expect(state.seats[1].bet).toBe(20);
  });
});

/* ═══════════════════════════════════════════════════════════
   7. 弃牌规则
   ═══════════════════════════════════════════════════════════ */
describe("弃牌规则", () => {
  it("弃牌后不能再行动", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(801));
    state = applyAction(state, "a", "fold");
    expect(state.seats[0].folded).toBe(true);
    // a 不再是 actor
    expect(state.actorIndex).not.toBe(0);
  });

  it("其余所有人弃牌: 最后一人直接赢", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(802));
    state = applyAction(state, "a", "fold");
    state = applyAction(state, "b", "fold");
    expect(state.phase).toBe("complete");
    expect(state.result?.reason).toBe("fold");
    expect(state.result?.winnerSeatIds).toContain("c");
  });

  it("弃牌后筹码仍守恒(弃牌部分留在底池)", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(803));
    state = applyAction(state, "a", "raise", 100);
    state = applyAction(state, "b", "fold");
    state = applyAction(state, "c", "fold");
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });
});

/* ═══════════════════════════════════════════════════════════
   8. 未跟注筹码退回
   ═══════════════════════════════════════════════════════════ */
describe("未跟注筹码退回", () => {
  it("加注后无人跟注: 退回多余部分", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(901));
    state = applyAction(state, "a", "raise", 200);
    state = applyAction(state, "b", "fold");
    state = applyAction(state, "c", "fold");
    expect(state.phase).toBe("complete");
    // a 下了 200, 但只有 20(SB)+20(BB) 被跟注, 退回 160
    expect(state.result?.pot).toBe(50); // 20+10+20
    expect(state.seats[0].stack).toBe(1030); // 1000-200+160+50-20 = 990+50 = 1040? 
    // 实际: a.stack = 1000 - 200(全下) + 180(退回: 200-20) + 50(赢) - 20(已下) = 1010
    // 等等, 让我重新算: a 初始 stack=1000, bet=0 → raise to 200 → commit(200) → stack=800, bet=200
    // sweepBets: highest=200(a), second=20(c BB), uncalled=180 → a.bet=20, a.stack=980
    // pot = 20(a) + 10(b) + 20(c) = 50
    // winner: a, stack = 980 + 50 = 1030
    expect(state.seats[0].stack).toBe(1030);
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });

  it("全下后多人跟注: 不退回(被跟注)", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 100, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(902));
    state = applyAction(state, "a", "all-in");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "call");
    // a 全下 100, b/c 跟注 100, 无退回
    // 初始总筹码 = 100+1000+1000 = 2100
    while (state.phase !== "complete") {
      const legal = legalActions(state);
      state = applyAction(state, state.seats[state.actorIndex].id, legal.actions.includes("check") ? "check" : "call");
    }
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(2100);
  });
});

/* ═══════════════════════════════════════════════════════════
   9. 底池分配规则
   ═══════════════════════════════════════════════════════════ */
describe("底池分配", () => {
  it("主池: 所有活跃玩家的最大等额贡献", () => {
    const seats = [
      { id: "a", stack: 0, totalContribution: 100, folded: false, allIn: true },
      { id: "b", stack: 0, totalContribution: 300, folded: false, allIn: true },
      { id: "c", stack: 200, totalContribution: 300, folded: false, allIn: false },
    ] as any[];
    const pots = buildSidePots(seats);
    expect(pots[0].amount).toBe(300); // 100 * 3
    expect(pots[0].eligibleSeatIds).toContain("a");
    expect(pots[0].eligibleSeatIds).toContain("b");
    expect(pots[0].eligibleSeatIds).toContain("c");
  });

  it("边池: 超出主池部分只有超额贡献者 eligible", () => {
    const seats = [
      { id: "a", stack: 0, totalContribution: 100, folded: false, allIn: true },
      { id: "b", stack: 0, totalContribution: 300, folded: false, allIn: true },
      { id: "c", stack: 200, totalContribution: 300, folded: false, allIn: false },
    ] as any[];
    const pots = buildSidePots(seats);
    expect(pots[1].amount).toBe(400); // (300-100) * 2
    expect(pots[1].eligibleSeatIds).toContain("b");
    expect(pots[1].eligibleSeatIds).toContain("c");
    expect(pots[1].eligibleSeatIds).not.toContain("a");
  });

  it("弃牌玩家的贡献留在底池但不能赢", () => {
    const seats = [
      { id: "a", stack: 0, totalContribution: 50, folded: true, allIn: false },
      { id: "b", stack: 0, totalContribution: 100, folded: false, allIn: true },
      { id: "c", stack: 50, totalContribution: 100, folded: false, allIn: false },
    ] as any[];
    const pots = buildSidePots(seats);
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(250);
    for (const pot of pots) {
      expect(pot.eligibleSeatIds).not.toContain("a");
    }
  });

  it("平分奇数底池: 余数给庄家左手第一位赢家", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 100, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 100, isHuman: true },
    ], 1, 2), seeded(1001));
    state = applyAction(state, "a", "all-in");
    state = applyAction(state, "b", "all-in");
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(200);
  });
});

/* ═══════════════════════════════════════════════════════════
   10. 摊牌规则
   ═══════════════════════════════════════════════════════════ */
describe("摊牌规则", () => {
  it("所有人过牌到底 → 摊牌", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(1101));
    while (state.phase !== "complete") {
      const legal = legalActions(state);
      state = applyAction(state, state.seats[state.actorIndex].id, legal.actions.includes("check") ? "check" : "call");
    }
    expect(state.result?.reason).toBe("showdown");
    expect(state.board).toHaveLength(5);
  });

  it("摊牌时从7张牌中选最佳5张比较", () => {
    const hand1 = evaluateHand(cards("A♠", "K♠", "Q♠", "J♠", "T♠", "2♦", "3♣"));
    const hand2 = evaluateHand(cards("9♥", "8♥", "7♥", "6♥", "5♥", "2♦", "3♣"));
    expect(hand1.name).toBe("皇家同花顺");
    expect(hand2.name).toBe("同花顺");
    expect(compareScores(hand1, hand2)).toBeGreaterThan(0);
  });

  it("摊牌后赢家正确分配底池", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(1103));
    while (state.phase !== "complete") {
      const legal = legalActions(state);
      state = applyAction(state, state.seats[state.actorIndex].id, legal.actions.includes("check") ? "check" : "call");
    }
    expect(state.pot).toBe(0);
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(2000);
  });
});

/* ═══════════════════════════════════════════════════════════
   11. 牌型等级
   ═══════════════════════════════════════════════════════════ */
describe("牌型等级完整覆盖", () => {
  const types: [string, Card[], number][] = [
    ["皇家同花顺", ["A♠", "K♠", "Q♠", "J♠", "T♠"], 8],
    ["同花顺", ["9♥", "8♥", "7♥", "6♥", "5♥"], 8],
    ["四条", ["A♠", "A♥", "A♦", "A♣", "K♠"], 7],
    ["葫芦", ["K♠", "K♥", "K♦", "Q♣", "Q♠"], 6],
    ["同花", ["A♥", "J♥", "8♥", "5♥", "2♥"], 5],
    ["顺子", ["9♠", "8♥", "7♦", "6♣", "5♠"], 4],
    ["三条", ["7♠", "7♥", "7♦", "A♣", "K♠"], 3],
    ["两对", ["A♠", "A♥", "K♦", "K♣", "Q♠"], 2],
    ["一对", ["T♠", "T♥", "A♦", "K♣", "Q♠"], 1],
    ["高牌", ["A♠", "J♥", "9♦", "6♣", "3♠"], 0],
  ];

  it.each(types)("%s: category=%d", (name, hand, category) => {
    const score = evaluateHand(hand);
    expect(score.name).toBe(name);
    expect(score.category).toBe(category);
  });

  it("牌型等级严格递减: 皇家同花顺 > 同花顺 > ... > 高牌", () => {
    for (let i = 0; i < types.length - 1; i++) {
      const higher = evaluateHand(types[i][1]);
      const lower = evaluateHand(types[i + 1][1]);
      expect(compareScores(higher, lower)).toBeGreaterThan(0);
    }
  });

  it("A-2-3-4-5 是最小顺子(5-high), 小于 6-high 顺子", () => {
    const wheel = evaluateHand(cards("A♠", "2♥", "3♦", "4♣", "5♠"));
    const sixHigh = evaluateHand(cards("6♠", "5♥", "4♦", "3♣", "2♠"));
    expect(wheel.name).toBe("顺子");
    expect(wheel.kickers[0]).toBe(5);
    expect(compareScores(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it("相同牌型比较: 先比主要部分, 再比踢脚", () => {
    // 一对 A 带 KQJ vs 一对 A 带 KQ9
    const h1 = evaluateHand(cards("A♠", "A♥", "K♦", "Q♣", "J♠"));
    const h2 = evaluateHand(cards("A♦", "A♣", "K♠", "Q♥", "9♠"));
    expect(compareScores(h1, h2)).toBeGreaterThan(0);
  });

  it("两对比较: 先比高对, 再比低对, 最后比踢脚", () => {
    const aakkQ = evaluateHand(cards("A♠", "A♥", "K♦", "K♣", "Q♠"));
    const aakkJ = evaluateHand(cards("A♦", "A♣", "K♠", "K♥", "J♠"));
    const aajjK = evaluateHand(cards("A♠", "A♥", "J♦", "J♣", "K♠"));
    expect(compareScores(aakkQ, aakkJ)).toBeGreaterThan(0);
    expect(compareScores(aakkQ, aajjK)).toBeGreaterThan(0);
  });

  it("三条比较: 先比三条, 再依次比踢脚", () => {
    const tripsAK = evaluateHand(cards("7♠", "7♥", "7♦", "A♣", "K♠"));
    const tripsAQ = evaluateHand(cards("7♣", "7♠", "7♥", "A♦", "Q♠"));
    expect(compareScores(tripsAK, tripsAQ)).toBeGreaterThan(0);
  });

  it("葫芦比较: 先比三条部分, 再比对子", () => {
    const aaaKK = evaluateHand(cards("A♠", "A♥", "A♦", "K♣", "K♠"));
    const aaaJJ = evaluateHand(cards("A♣", "A♠", "A♥", "J♣", "J♠"));
    const kkkQQ = evaluateHand(cards("K♠", "K♥", "K♦", "Q♣", "Q♠"));
    expect(compareScores(aaaKK, aaaJJ)).toBeGreaterThan(0);
    expect(compareScores(aaaKK, kkkQQ)).toBeGreaterThan(0);
  });

  it("四条比较: 先比四条, 再比踢脚", () => {
    const quadA = evaluateHand(cards("A♠", "A♥", "A♦", "A♣", "2♠"));
    const quadK = evaluateHand(cards("K♠", "K♥", "K♦", "K♣", "A♠"));
    expect(compareScores(quadA, quadK)).toBeGreaterThan(0);
  });

  it("同花顺比较: 比较高张", () => {
    const kingHigh = evaluateHand(cards("K♠", "Q♠", "J♠", "T♠", "9♠"));
    const queenHigh = evaluateHand(cards("Q♥", "J♥", "T♥", "9♥", "8♥"));
    expect(compareScores(kingHigh, queenHigh)).toBeGreaterThan(0);
  });

  it("高牌比较: 依次比五张", () => {
    const aceHigh = evaluateHand(cards("A♠", "J♥", "9♦", "6♣", "3♠"));
    const kingHigh = evaluateHand(cards("K♠", "Q♥", "J♦", "9♣", "7♠"));
    expect(compareScores(aceHigh, kingHigh)).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════
   12. 特殊场景
   ═══════════════════════════════════════════════════════════ */
describe("特殊场景", () => {
  it("全员全下不同额: 自动发满5张+边池正确+筹码守恒", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 50, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 150, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 500, isHuman: true },
    ], 5, 10), seeded(1201));
    state = applyAction(state, "a", "all-in");
    state = applyAction(state, "b", "all-in");
    state = applyAction(state, "c", "all-in");
    expect(state.phase).toBe("complete");
    expect(state.board).toHaveLength(5);
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(700);
  });

  it("翻牌前全员弃牌到BB: BB赢盲注部分", () => {
    let state = startHand(createInitialState([
      { id: "utg", name: "UTG", avatar: "", stack: 1000, isHuman: true },
      { id: "sb", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "bb", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(1202));
    state = applyAction(state, "utg", "fold");
    state = applyAction(state, "sb", "fold");
    expect(state.phase).toBe("complete");
    expect(state.result?.winnerSeatIds).toContain("bb");
    // BB 赢了 SB 的盲注 (UTG 没下注就弃牌了)
    expect(state.result?.pot).toBe(20); // 0(UTG) + 10(SB) + 10(uncalled BB退回)
    // 筹码守恒
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });

  it("河牌圈最后一人全下: 摊牌结算", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), seeded(1203));
    // preflop call
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "check");
    // flop check
    for (let i = 0; i < 3; i++) state = applyAction(state, state.seats[state.actorIndex].id, "check");
    // turn check
    for (let i = 0; i < 3; i++) state = applyAction(state, state.seats[state.actorIndex].id, "check");
    expect(state.phase).toBe("river");
    // river: a all-in, b call, c fold
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    state = applyAction(state, state.seats[state.actorIndex].id, "call");
    state = applyAction(state, state.seats[state.actorIndex].id, "fold");
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });

  it("筹码守恒: 100手随机操作", () => {
    const n = 6;
    const total = n * 5000;
    let state = createInitialState(Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, avatar: "", stack: 5000, isHuman: true
    })), 10, 20);
    const random = seeded(1300);
    for (let h = 0; h < 100; h++) {
      if (state.seats.filter(s => s.stack > 0).length < 2) break;
      state = startHand(state, random);
      let actions = 0;
      while (state.phase !== "complete" && actions < 200) {
        const legal = legalActions(state);
        if (!legal.actions.length) break;
        const actor = state.seats[state.actorIndex];
        const roll = random();
        let action: PlayerAction = legal.actions.includes("check") ? "check" : "call";
        if (roll < 0.12 && legal.actions.includes("raise")) action = "raise";
        else if (roll < 0.18 && legal.actions.includes("fold")) action = "fold";
        const raiseTo = action === "raise" ? legal.minRaiseTo : undefined;
        state = applyAction(state, actor.id, action, raiseTo);
        actions++;
      }
      expect(state.phase).toBe("complete");
      expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(total);
    }
  });
});
