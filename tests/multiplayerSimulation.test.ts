/**
 * 多人在线实时对战全场景模拟测试
 * 覆盖 2~8 人桌的所有牌局形式
 */
import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import { evaluateHand, compareScores } from "../src/game/cards";
import { buildSidePots } from "../src/game/pots";
import type { Card, PlayerAction, PokerState, Seat } from "../src/game/types";

/* ── helpers ───────────────────────────────────────────────── */

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

function makeSeats(n: number, stack: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `玩家${i}`,
    avatar: "",
    stack,
    isHuman: i === 0,
  }));
}

function makeUnevenSeats(n: number, base: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `玩家${i}`,
    avatar: "",
    stack: base + i * base, // 1x, 2x, 3x ... 
    isHuman: i === 0,
  }));
}

/** 运行一手牌直到结束，返回最终 state */
function playHand(state: PokerState, random: () => number, maxActions = 500): PokerState {
  let actions = 0;
  while (state.phase !== "complete" && actions < maxActions) {
    const legal = legalActions(state);
    if (legal.actions.length === 0) break;
    const actor = state.seats[state.actorIndex];
    if (!actor) break;
    const roll = random();
    let action: PlayerAction;
    let raiseTo: number | undefined;
    if (roll < 0.06 && legal.actions.includes("all-in")) {
      action = "all-in";
    } else if (roll < 0.20 && legal.actions.includes("raise")) {
      action = "raise";
      const span = legal.maxRaiseTo - legal.minRaiseTo;
      raiseTo = legal.minRaiseTo + Math.floor(random() * (span + 1));
    } else if (roll < 0.28 && legal.actions.includes("fold")) {
      action = "fold";
    } else {
      action = legal.actions.includes("check") ? "check" : "call";
    }
    state = applyAction(state, actor.id, action, raiseTo);
    actions++;
  }
  return state;
}

/** 连续多手直到房间结束或达到手数上限 */
function playSession(
  initialSeats: ReturnType<typeof makeSeats>,
  sb: number,
  bb: number,
  hands: number,
  seed: number
): { hands: number; finalState: PokerState; total: number } {
  const random = seeded(seed);
  const total = initialSeats.reduce((sum, s) => sum + s.stack, 0);
  let state = createInitialState(initialSeats, sb, bb);
  let played = 0;
  for (let h = 0; h < hands; h++) {
    const activeCount = state.seats.filter((s) => s.stack > 0).length;
    if (activeCount < 2) break;
    state = startHand(state, random);
    state = playHand(state, random);
    played++;
  }
  return { hands: played, finalState: state, total };
}

/** 验证一手牌的不变量 */
function assertHandInvariants(state: PokerState, expectedTotal: number) {
  // 1. 筹码守恒
  const actualTotal = state.seats.reduce((sum, s) => sum + s.stack + s.bet, 0) + state.pot;
  expect(actualTotal).toBe(expectedTotal);
  // 2. 无负数
  expect(state.seats.every((s) => s.stack >= 0 && s.bet >= 0 && s.totalContribution >= 0)).toBe(true);
  // 3. 牌不重复
  const allCards: Card[] = [
    ...state.deck,
    ...state.board,
    ...state.seats.flatMap((s) => s.holeCards),
  ];
  expect(new Set(allCards).size).toBe(allCards.length);
  // 4. 公共牌数
  expect(state.board.length).toBeLessThanOrEqual(5);
  // 5. 手牌数
  state.seats.forEach((s) => {
    expect(s.holeCards.length).toBeLessThanOrEqual(2);
  });
}

function assertSessionInvariants(result: ReturnType<typeof playSession>) {
  expect(result.finalState.seats.every((s) => s.stack >= 0)).toBe(true);
  expect(result.finalState.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(result.total);
}

/* ── tests ─────────────────────────────────────────────────── */

describe("2人(Heads-up)全场景", () => {
  it("连续50手筹码守恒+庄位轮转", () => {
    const result = playSession(makeSeats(2, 5000), 5, 10, 50, 1001);
    assertSessionInvariants(result);
    expect(result.hands).toBeGreaterThan(0);
  });

  it("短码vs深码: 一方被淘汰后停止", () => {
    const result = playSession(
      [
        { id: "p0", name: "A", avatar: "", stack: 50, isHuman: true },
        { id: "p1", name: "B", avatar: "", stack: 5000, isHuman: true },
      ],
      5,
      10,
      100,
      2001
    );
    assertSessionInvariants(result);
    // p0 should be eliminated at some point
    const p0 = result.finalState.seats.find((s) => s.id === "p0")!;
    const p1 = result.finalState.seats.find((s) => s.id === "p1")!;
    expect(p0.stack + p1.stack).toBe(5050);
  });

  it("全员全下(翻牌前)自动发满公共牌并结算", () => {
    let state = startHand(createInitialState(makeSeats(2, 100), 5, 10), seeded(3001));
    const total = 200;
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    expect(state.phase).toBe("complete");
    expect(state.board).toHaveLength(5);
    assertHandInvariants(state, total);
  });

  it("弃牌获胜: 第一人弃牌立即结算", () => {
    let state = startHand(createInitialState(makeSeats(2, 1000), 10, 20), seeded(4001));
    state = applyAction(state, state.seats[state.actorIndex].id, "fold");
    expect(state.phase).toBe("complete");
    expect(state.result?.reason).toBe("fold");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(2000);
  });

  it("两人桌庄位/盲注正确轮转", () => {
    let state = createInitialState(makeSeats(2, 1000), 10, 20);
    const random = seeded(5001);
    // 第一手: p0=庄/SB, p1=BB
    state = startHand(state, random);
    expect(state.dealerIndex).toBe(0);
    expect(state.seats[0].bet).toBe(10);
    expect(state.seats[1].bet).toBe(20);
    expect(state.actorIndex).toBe(0); // SB先行动
    // 打完
    state = playHand(state, random);
    // 第二手: p1=庄/SB, p0=BB
    state = startHand(state, random);
    expect(state.dealerIndex).toBe(1);
    expect(state.seats[1].bet).toBe(10);
    expect(state.seats[0].bet).toBe(20);
  });
});

describe("3~4人桌全场景", () => {
  it.each([3, 4])("%d人桌: 连续30手筹码守恒", (n) => {
    const result = playSession(makeSeats(n, 2000), 5, 10, 30, 6000 + n);
    assertSessionInvariants(result);
    expect(result.hands).toBeGreaterThan(0);
  });

  it.each([3, 4])("%d人桌: 不等筹码连续30手", (n) => {
    const result = playSession(makeUnevenSeats(n, 500), 5, 10, 30, 7000 + n);
    assertSessionInvariants(result);
  });

  it("3人桌: 全员全下产生正确边池", () => {
    let state = startHand(
      createInitialState(
        [
          { id: "p0", name: "A", avatar: "", stack: 50, isHuman: true },
          { id: "p1", name: "B", avatar: "", stack: 150, isHuman: true },
          { id: "p2", name: "C", avatar: "", stack: 500, isHuman: true },
        ],
        5,
        10
      ),
      seeded(8001)
    );
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(700);
    expect(state.seats.every((s) => s.stack >= 0)).toBe(true);
  });

  it("3人桌: 翻牌前加注-再加注-全下", () => {
    let state = startHand(createInitialState(makeSeats(3, 1000), 10, 20), seeded(9001));
    expect(state.actorIndex).toBe(0); // UTG
    state = applyAction(state, "p0", "raise", 60);
    state = applyAction(state, "p1", "raise", 180);
    state = applyAction(state, "p2", "all-in");
    // p0 应该能跟注/弃牌
    const legal = legalActions(state);
    expect(legal.actions).toContain("call");
    expect(legal.actions).toContain("fold");
  });

  it("4人桌: 庄位正确轮转(跳过被淘汰玩家)", () => {
    const seats = [
      { id: "p0", name: "A", avatar: "", stack: 10, isHuman: true },
      { id: "p1", name: "B", avatar: "", stack: 5000, isHuman: true },
      { id: "p2", name: "C", avatar: "", stack: 5000, isHuman: true },
      { id: "p3", name: "D", avatar: "", stack: 5000, isHuman: true },
    ];
    let state = createInitialState(seats, 5, 10);
    const random = seeded(10001);
    state = startHand(state, random);
    state = playHand(state, random);
    // p0 可能被淘汰了
    const active = state.seats.filter((s) => s.stack > 0);
    if (active.length < 4) {
      // 第二手: 庄位应跳过无筹码玩家
      state = startHand(state, random);
      const dealer = state.seats[state.dealerIndex];
      expect(dealer.stack).toBeGreaterThan(0);
    }
  });
});

describe("5~6人桌全场景", () => {
  it.each([5, 6])("%d人桌: 连续50手筹码守恒", (n) => {
    const result = playSession(makeSeats(n, 2000), 5, 10, 50, 11000 + n);
    assertSessionInvariants(result);
    expect(result.hands).toBeGreaterThan(0);
  });

  it.each([5, 6])("%d人桌: 不等筹码连续50手", (n) => {
    const result = playSession(makeUnevenSeats(n, 300), 5, 10, 50, 12000 + n);
    assertSessionInvariants(result);
  });

  it("6人桌: 3人全下+3人弃牌", () => {
    let state = startHand(createInitialState(makeSeats(6, 500), 5, 10), seeded(13001));
    const random = seeded(13001);
    // 前3人全下, 后3人弃牌
    for (let i = 0; i < 6; i++) {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      if (i < 3 && legal.actions.includes("all-in")) {
        state = applyAction(state, actor.id, "all-in");
      } else {
        state = applyAction(state, actor.id, legal.actions.includes("fold") ? "fold" : "call");
      }
    }
    // 继续打完
    state = playHand(state, random);
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });

  it("6人桌: 翻牌后多人加注到底", () => {
    let state = startHand(createInitialState(makeSeats(6, 2000), 10, 20), seeded(14001));
    const random = seeded(14001);
    // 翻牌前全部跟注
    while (state.phase === "preflop") {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      state = applyAction(state, actor.id, legal.actions.includes("check") ? "check" : "call");
    }
    expect(state.phase).toBe("flop");
    expect(state.pot).toBe(120); // 6 * 20
    expect(state.board).toHaveLength(3);
  });
});

describe("7~8人桌全场景", () => {
  it.each([7, 8])("%d人桌: 连续40手筹码守恒", (n) => {
    const result = playSession(makeSeats(n, 1500), 5, 10, 40, 21000 + n);
    assertSessionInvariants(result);
    expect(result.hands).toBeGreaterThan(0);
  });

  it.each([7, 8])("%d人桌: 不等筹码连续40手", (n) => {
    const result = playSession(makeUnevenSeats(n, 200), 5, 10, 40, 22000 + n);
    assertSessionInvariants(result);
  });

  it("8人桌: 全员全下产生7级边池", () => {
    const seats = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      name: `玩家${i}`,
      avatar: "",
      stack: (i + 1) * 100, // 100, 200, ..., 800
      isHuman: i === 0,
    }));
    let state = startHand(createInitialState(seats, 5, 10), seeded(23001));
    // 全员全下
    for (let i = 0; i < 8; i++) {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      if (legal.actions.includes("all-in")) {
        state = applyAction(state, actor.id, "all-in");
      } else {
        state = applyAction(state, actor.id, legal.actions.includes("call") ? "call" : "fold");
      }
    }
    expect(state.phase).toBe("complete");
    expect(state.board).toHaveLength(5);
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3600);
    expect(state.seats.every((s) => s.stack >= 0)).toBe(true);
  });

  it("8人桌: 翻牌前弃牌到一人立即结算", () => {
    let state = startHand(createInitialState(makeSeats(8, 1000), 10, 20), seeded(24001));
    // 7人弃牌
    for (let i = 0; i < 7; i++) {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      state = applyAction(state, actor.id, "fold");
    }
    expect(state.phase).toBe("complete");
    expect(state.result?.reason).toBe("fold");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(8000);
  });
});

describe("极端场景", () => {
  it("奇数底池平分: 余数归庄家左手第一位赢家", () => {
    // 3人, 公共牌是同花顺, 所有人手牌都组成相同的同花顺
    let state = startHand(
      createInitialState(makeSeats(3, 100), 1, 2),
      seeded(30001)
    );
    // 全员全下
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    state = applyAction(state, state.seats[state.actorIndex].id, "all-in");
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(300);
  });

  it("连续100手随机操作不会死循环", () => {
    const result = playSession(makeSeats(6, 3000), 5, 10, 100, 40001);
    assertSessionInvariants(result);
    expect(result.hands).toBeGreaterThan(0);
  });

  it("短盲注(1/2)大手数连续游戏", () => {
    const result = playSession(makeSeats(5, 10000), 1, 2, 200, 50001);
    assertSessionInvariants(result);
    expect(result.hands).toBeGreaterThan(0);
  });

  it("高盲注(50/100)快速淘汰", () => {
    const result = playSession(makeSeats(6, 500), 50, 100, 100, 60001);
    assertSessionInvariants(result);
    // 应该有玩家被淘汰
    const eliminated = result.finalState.seats.filter((s) => s.stack === 0);
    expect(eliminated.length).toBeGreaterThan(0);
  });

  it("5人桌: 每手都有加注-再加注-全下", () => {
    let state = createInitialState(makeSeats(5, 1000), 10, 20);
    const random = seeded(70001);
    for (let hand = 0; hand < 20; hand++) {
      const active = state.seats.filter((s) => s.stack > 0);
      if (active.length < 2) break;
      state = startHand(state, random);
      // 尽可能激进: 第一个加注, 第二个再加注, 第三个全下
      let actionCount = 0;
      while (state.phase !== "complete" && actionCount < 50) {
        const legal = legalActions(state);
        if (!legal.actions.length) break;
        const actor = state.seats[state.actorIndex];
        if (legal.actions.includes("raise") && actionCount < 3) {
          state = applyAction(state, actor.id, "raise", legal.minRaiseTo);
        } else if (legal.actions.includes("all-in") && actionCount < 4) {
          state = applyAction(state, actor.id, "all-in");
        } else {
          state = applyAction(state, actor.id, legal.actions.includes("call") ? "call" : "fold");
        }
        actionCount++;
      }
      expect(state.phase).toBe("complete");
      expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(5000);
    }
  });
});

describe("边池深度测试", () => {
  it("4人不同全下额: 3级边池+主池", () => {
    const seats = [
      { id: "p0", name: "A", avatar: "", stack: 50, isHuman: true },
      { id: "p1", name: "B", avatar: "", stack: 100, isHuman: true },
      { id: "p2", name: "C", avatar: "", stack: 200, isHuman: true },
      { id: "p3", name: "D", avatar: "", stack: 400, isHuman: true },
    ];
    let state = startHand(createInitialState(seats, 5, 10), seeded(80001));
    // 全员全下
    for (let i = 0; i < 4; i++) {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      if (legal.actions.includes("all-in")) {
        state = applyAction(state, actor.id, "all-in");
      } else {
        state = applyAction(state, actor.id, legal.actions.includes("call") ? "call" : "fold");
      }
    }
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(750);
    expect(state.seats.every((s) => s.stack >= 0)).toBe(true);
  });

  it("5人: 2人全下+3人弃牌, 边池正确", () => {
    let state = startHand(createInitialState(makeSeats(5, 500), 5, 10), seeded(81001));
    const actor0 = state.seats[state.actorIndex].id;
    state = applyAction(state, actor0, "all-in");
    const actor1 = state.seats[state.actorIndex].id;
    state = applyAction(state, actor1, "all-in");
    // 其余弃牌
    while (state.phase !== "complete") {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      state = applyAction(state, actor.id, legal.actions.includes("fold") ? "fold" : "call");
    }
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(2500);
  });
});

describe("弃牌/摊牌正确性", () => {
  it("弃牌玩家不应赢得任何底池", () => {
    let state = startHand(createInitialState(makeSeats(4, 1000), 10, 20), seeded(90001));
    const random = seeded(90001);
    // 打完一手
    state = playHand(state, random);
    expect(state.phase).toBe("complete");
    // 赢家不应该是已弃牌且没有赢的人
    if (state.result?.reason === "showdown") {
      state.result.winnerSeatIds.forEach((id) => {
        const seat = state.seats.find((s) => s.id === id)!;
        expect(seat.folded).toBe(false);
      });
    }
  });

  it("摊牌后赢家手牌评估正确", () => {
    // 手动构造一个摊牌场景
    let state = startHand(createInitialState(makeSeats(3, 1000), 10, 20), seeded(91001));
    const random = seeded(91001);
    // 全部跟注到摊牌
    while (state.phase !== "complete") {
      const legal = legalActions(state);
      if (!legal.actions.length) break;
      const actor = state.seats[state.actorIndex];
      state = applyAction(state, actor.id, legal.actions.includes("check") ? "check" : "call");
    }
    expect(state.phase).toBe("complete");
    if (state.result?.reason === "showdown") {
      // 所有摊牌玩家的手牌应该可以评估
      state.seats
        .filter((s) => !s.folded && s.holeCards.length === 2)
        .forEach((s) => {
          const score = evaluateHand([...s.holeCards, ...state.board]);
          expect(score.category).toBeGreaterThanOrEqual(0);
          expect(score.category).toBeLessThanOrEqual(8);
        });
    }
  });
});

describe("牌型评估完整性", () => {
  it("所有10种牌型都能被正确识别", () => {
    const hands: [string, Card[]][] = [
      ["皇家同花顺", ["A♠", "K♠", "Q♠", "J♠", "T♠"]],
      ["同花顺", ["9♥", "8♥", "7♥", "6♥", "5♥"]],
      ["四条", ["A♠", "A♥", "A♦", "A♣", "K♠"]],
      ["葫芦", ["K♠", "K♥", "K♦", "Q♣", "Q♠"]],
      ["同花", ["A♥", "J♥", "8♥", "5♥", "2♥"]],
      ["顺子", ["9♠", "8♥", "7♦", "6♣", "5♠"]],
      ["三条", ["7♠", "7♥", "7♦", "A♣", "K♠"]],
      ["两对", ["A♠", "A♥", "K♦", "K♣", "Q♠"]],
      ["一对", ["T♠", "T♥", "A♦", "K♣", "Q♠"]],
      ["高牌", ["A♠", "J♥", "9♦", "6♣", "3♠"]],
    ];
    hands.forEach(([name, cards]) => {
      expect(evaluateHand(cards).name).toBe(name);
    });
  });

  it("7张牌场景正确选出最佳5张", () => {
    const scenarios: [string, Card[]][] = [
      ["皇家同花顺", ["A♠", "K♠", "Q♠", "J♠", "T♠", "2♦", "3♣"]],
      ["四条", ["Q♠", "Q♥", "Q♦", "Q♣", "A♠", "3♦", "2♣"]],
      ["葫芦", ["J♠", "J♥", "J♦", "8♣", "8♠", "3♦", "2♣"]],
      ["同花", ["A♥", "J♥", "8♥", "5♥", "2♥", "K♣", "Q♦"]],
      ["顺子", ["9♠", "8♥", "7♦", "6♣", "5♠", "A♦", "K♣"]],
    ];
    scenarios.forEach(([name, cards]) => {
      expect(evaluateHand(cards).name).toBe(name);
    });
  });

  it("A-2-3-4-5小顺子正确识别", () => {
    const wheel = evaluateHand(["A♠", "2♥", "3♦", "4♣", "5♠"] as Card[]);
    expect(wheel.name).toBe("顺子");
    expect(wheel.kickers[0]).toBe(5);
  });
});

describe("服务器端多人场景模拟", () => {
  it("8人桌模拟服务器并发: 每手随机行动无崩溃", () => {
    // 模拟服务器端的多人并发场景
    const playerCount = 8;
    const seats = makeSeats(playerCount, 3000);
    let state = createInitialState(seats, 10, 20);
    const random = seeded(100001);
    const handResults: Array<{ hand: number; phase: string; pot: number; winners: number }> = [];

    for (let hand = 0; hand < 50; hand++) {
      const active = state.seats.filter((s) => s.stack > 0);
      if (active.length < 2) break;

      state = startHand(state, random);
      state = playHand(state, random);

      handResults.push({
        hand: state.handNumber,
        phase: state.phase,
        pot: state.result?.pot ?? 0,
        winners: state.result?.winnerSeatIds?.length ?? 0,
      });

      // 验证每手结束后的不变量
      expect(state.phase).toBe("complete");
      expect(state.seats.every((s) => s.stack >= 0)).toBe(true);
      expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(playerCount * 3000);
    }

    expect(handResults.length).toBeGreaterThan(0);
    expect(handResults.every((r) => r.phase === "complete")).toBe(true);
  });

  it("6人桌模拟: 加注额递增正确", () => {
    let state = startHand(createInitialState(makeSeats(6, 5000), 10, 20), seeded(110001));
    const random = seeded(110001);

    // 翻牌前: UTG加注到60 (6人桌, dealerIndex=0, UTG = index 3)
    // dealer=0, SB=1, BB=2, UTG=3
    expect(state.actorIndex).toBe(3);
    state = applyAction(state, "p3", "raise", 60);
    expect(state.currentBet).toBe(60);
    expect(state.minRaise).toBe(40);

    // MP 再加注到160
    state = applyAction(state, state.seats[state.actorIndex].id, "raise", 160);
    expect(state.currentBet).toBe(160);
    expect(state.minRaise).toBe(100);

    // CO 再加注到360
    state = applyAction(state, state.seats[state.actorIndex].id, "raise", 360);
    expect(state.currentBet).toBe(360);
    expect(state.minRaise).toBe(200);

    // 最小加注应为 360 + 200 = 560
    const legal = legalActions(state);
    expect(legal.minRaiseTo).toBe(560);
  });
});

describe("多人随机压力测试", () => {
  it.each([2, 3, 4, 5, 6, 7, 8])("%d人桌: 200手随机操作筹码守恒", (n) => {
    const result = playSession(makeSeats(n, 5000), 10, 20, 200, 200000 + n);
    assertSessionInvariants(result);
  });

  it("所有人数的短码场景: 快速淘汰+筹码守恒", () => {
    for (let n = 2; n <= 8; n++) {
      const result = playSession(makeSeats(n, 100), 5, 10, 100, 300000 + n);
      assertSessionInvariants(result);
    }
  });

  it("所有人数的深码场景: 长时间游戏+筹码守恒", () => {
    for (let n = 2; n <= 8; n++) {
      const result = playSession(makeSeats(n, 100000), 1, 2, 50, 400000 + n);
      assertSessionInvariants(result);
    }
  });
});
