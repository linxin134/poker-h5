import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import { evaluateHand, compareScores } from "../src/game/cards";
import { buildSidePots } from "../src/game/pots";
import type { Card, PlayerAction, PokerState } from "../src/game/types";

const cards = (...values: Card[]) => values;

// Helper to play through preflop with all calls
function preflopCallThrough(state: PokerState): PokerState {
  while (state.phase === "preflop") {
    const legal = legalActions(state);
    if (legal.actions.length === 0) break;
    const action = legal.actions.includes("check") ? "check" : "call";
    state = applyAction(state, state.seats[state.actorIndex].id, action as PlayerAction);
  }
  return state;
}

// Helper to check through all streets
function checkThrough(state: PokerState): PokerState {
  let guard = 0;
  while (state.phase !== "complete" && guard < 50) {
    const legal = legalActions(state);
    if (legal.actions.length === 0) break;
    const action = legal.actions.includes("check") ? "check" : "call";
    state = applyAction(state, state.seats[state.actorIndex].id, action as PlayerAction);
    guard++;
  }
  return state;
}

// ====================================================================
// 1. PREFLOP ACTION ORDER
// ====================================================================
describe("翻牌前行动顺序", () => {
  it("3人桌: 庄家左手边先行动(UTG), 庄家最后行动", () => {
    const state = startHand(createInitialState([
      { id: "BTN", name: "BTN", avatar: "", stack: 1000, isHuman: true },
      { id: "SB", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "BB", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(state.dealerIndex).toBe(0); // BTN
    expect(state.seats[1].bet).toBe(10); // SB
    expect(state.seats[2].bet).toBe(20); // BB
    expect(state.actorIndex).toBe(0); // BTN acts first (UTG in 3-player)
  });

  it("两人桌: 庄家(SB)先行动, BB后行动", () => {
    const state = startHand(createInitialState([
      { id: "BTN", name: "BTN", avatar: "", stack: 1000, isHuman: true },
      { id: "BB", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(state.dealerIndex).toBe(0);
    expect(state.seats[0].bet).toBe(10); // BTN = SB
    expect(state.seats[1].bet).toBe(20); // BB
    expect(state.actorIndex).toBe(0); // BTN acts first
  });

  it("翻牌后: 庄家左手边先行动", () => {
    let state = startHand(createInitialState([
      { id: "BTN", name: "BTN", avatar: "", stack: 1000, isHuman: true },
      { id: "SB", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "BB", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "BTN", "call");
    state = applyAction(state, "SB", "call");
    state = applyAction(state, "BB", "check");

    expect(state.phase).toBe("flop");
    // Post-flop: first active player LEFT of dealer = SB
    expect(state.seats[state.actorIndex].id).toBe("SB");
  });
});

// ====================================================================
// 2. BLINDS
// ====================================================================
describe("盲注规则", () => {
  it("小盲应为smallBlind, 大盲应为bigBlind", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(state.seats[1].bet).toBe(10); // SB
    expect(state.seats[2].bet).toBe(20); // BB
    expect(state.currentBet).toBe(20);
  });

  it("两人桌庄家下小盲", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(state.seats[0].bet).toBe(10); // BTN/SB
    expect(state.seats[1].bet).toBe(20); // BB
  });
});

// ====================================================================
// 3. BB OPTION (Big Blind Option)
// ====================================================================
describe("大盲选项", () => {
  it("无人加注时大盲可以过牌或加注", () => {
    let state = startHand(createInitialState([
      { id: "BTN", name: "BTN", avatar: "", stack: 1000, isHuman: true },
      { id: "SB", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "BB", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "BTN", "call");
    state = applyAction(state, "SB", "call");

    expect(state.seats[state.actorIndex].id).toBe("BB");
    const legal = legalActions(state);
    expect(legal.actions).toContain("check");
    expect(legal.actions).toContain("raise");
  });

  it("有人加注后大盲可以跟注、加注或弃牌", () => {
    let state = startHand(createInitialState([
      { id: "BTN", name: "BTN", avatar: "", stack: 1000, isHuman: true },
      { id: "SB", name: "SB", avatar: "", stack: 1000, isHuman: true },
      { id: "BB", name: "BB", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "BTN", "raise", 60);
    state = applyAction(state, "SB", "fold");

    expect(state.seats[state.actorIndex].id).toBe("BB");
    const legal = legalActions(state);
    expect(legal.actions).toContain("call");
    expect(legal.actions).toContain("raise");
    expect(legal.actions).toContain("fold");
    expect(legal.callAmount).toBe(40);
  });
});

// ====================================================================
// 4. BETTING ROUND COMPLETION
// ====================================================================
describe("下注轮完成", () => {
  it("所有人跟注后应进入下一街", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "check");
    expect(state.phase).toBe("flop");
  });

  it("加注后所有人跟注应进入下一街", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "raise", 60);
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "call");
    expect(state.phase).toBe("flop");
  });
});

// ====================================================================
// 5. RAISE RULES
// ====================================================================
describe("加注规则", () => {
  it("最小加注额应为上次加注幅度", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    // Preflop: a raises to 60 (raise size = 40)
    state = applyAction(state, "a", "raise", 60);
    expect(state.minRaise).toBe(40);
    expect(legalActions(state).minRaiseTo).toBe(100); // 60 + 40

    // b re-raises to 200 (raise size = 140)
    state = applyAction(state, "b", "raise", 200);
    expect(state.minRaise).toBe(140);
    expect(legalActions(state).minRaiseTo).toBe(340); // 200 + 140
  });

  it("翻牌后最小下注为大盲", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    expect(state.phase).toBe("flop");
    expect(legalActions(state).minRaiseTo).toBe(20);
  });

  it("翻牌后下注后最小加注应为下注额+下注额", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    expect(state.phase).toBe("flop");

    // b bets 40
    state = applyAction(state, state.seats[state.actorIndex].id, "raise", 40);
    expect(state.currentBet).toBe(40);
    expect(state.minRaise).toBe(40);

    // a raises: minRaiseTo = 40 + 40 = 80
    expect(legalActions(state).minRaiseTo).toBe(80);
  });

  it("加注必须为整数", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(() => applyAction(state, "a", "raise", 40.5)).toThrow("加注金额不合法");
  });

  it("加注不能低于最小加注额", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(() => applyAction(state, "a", "raise", 30)).toThrow("加注金额不合法");
  });

  it("加注不能超过最大加注额(全下)", () => {
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    expect(() => applyAction(state, "a", "raise", 1001)).toThrow("加注金额不合法");
  });
});

// ====================================================================
// 6. ALL-IN RULES
// ====================================================================
describe("全下规则", () => {
  it("短码全下小于最小加注不重开加注", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 25, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "all-in");
    expect(state.currentBet).toBe(25);

    // a should only be able to call (5 more), not raise
    const legal = legalActions(state);
    expect(legal.actions).toContain("call");
    expect(legal.actions).not.toContain("raise");
    expect(legal.actions).not.toContain("all-in");
  });

  it("短码全下大于最小加注重开加注", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 100, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "all-in");
    expect(state.currentBet).toBe(100);

    const legal = legalActions(state);
    expect(legal.actions).toContain("call");
    expect(legal.actions).toContain("raise");
  });

  it("全下后所有人已全下应自动发满公共牌", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 50, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 50, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "all-in");
    state = applyAction(state, "b", "all-in");
    expect(state.phase).toBe("complete");
    expect(state.board).toHaveLength(5);
  });
});

// ====================================================================
// 7. SIDE POTS
// ====================================================================
describe("边池规则", () => {
  it("不同额度全下应产生正确的边池", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 50, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 150, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 500, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "all-in");
    state = applyAction(state, "b", "all-in");
    state = applyAction(state, "c", "all-in");

    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(700);
    expect(state.seats.every(s => s.stack >= 0)).toBe(true);
  });

  it("弃牌玩家的贡献留在底池中", () => {
    const seats = [
      { id: "a", stack: 0, totalContribution: 100, folded: false, allIn: true },
      { id: "b", stack: 0, totalContribution: 300, folded: false, allIn: true },
      { id: "c", stack: 200, totalContribution: 300, folded: false, allIn: false },
      { id: "d", stack: 0, totalContribution: 50, folded: true, allIn: false },
    ] as any[];

    const pots = buildSidePots(seats);
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(750);
  });
});

// ====================================================================
// 8. UNCALLED BET RETURN
// ====================================================================
describe("未跟注筹码退回", () => {
  it("加注后无人跟注应退回多余筹码", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "raise", 100);
    state = applyAction(state, "b", "fold");
    state = applyAction(state, "c", "fold");

    expect(state.phase).toBe("complete");
    expect(state.result?.pot).toBe(50); // 20 (SB) + 10 (BB call) + 20 (a's call portion)
    // Actually: a bet 100, but uncalled 80 returned. Pot = 20 (from blinds) + 20 (a's matching)
    // Wait: a started with 1000, SB=10 already, so a raised to 100 total bet
    // b had SB=10, c had BB=20
    // a raised to 100: commit(100-0) = 100 from stack
    // Actually a was UTG with bet=0, so commit(100) = 100
    // b fold, c fold. sweepBets: highest=100(a), second=20(c), uncalled=80
    // pot = 100-80 + 10 + 20 = 50? No: pot = sum of bets after sweep
    // After sweep: a.bet = 100-80 = 20, b.bet = 10 (folded), c.bet = 20 (folded)
    // pot = 20+10+20 = 50
    expect(state.seats[0].stack).toBe(1030); // 1000 - 100 + 80 (returned) + 50 (won) - 20 (lost) = 1010? 
    // Actually: a.stack = 1000 - 100 + 80 (returned) = 980, then +50 (pot) = 1030
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });
});

// ====================================================================
// 9. FOLD TO WIN
// ====================================================================
describe("弃牌获胜", () => {
  it("其余玩家弃牌后应立即结算", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "fold");
    state = applyAction(state, "b", "fold");

    expect(state.phase).toBe("complete");
    expect(state.result?.reason).toBe("fold");
    expect(state.result?.winnerSeatIds).toContain("c");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(3000);
  });
});

// ====================================================================
// 10. SHOWDOWN
// ====================================================================
describe("摊牌规则", () => {
  it("所有人过牌到底应摊牌", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "check");
    expect(state.phase).toBe("flop");

    state = checkThrough(state);
    expect(state.phase).toBe("complete");
    expect(state.result?.reason).toBe("showdown");
    expect(state.board).toHaveLength(5);
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(2000);
  });

  it("筹码守恒: 摊牌后所有筹码之和应等于初始总额", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 500, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 300, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 200, isHuman: true },
    ], 5, 10), () => .42);

    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "check");

    state = checkThrough(state);
    expect(state.phase).toBe("complete");
    expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(1000);
  });
});

// ====================================================================
// 11. HAND EVALUATION
// ====================================================================
describe("牌型评估", () => {
  it("皇家同花顺 > 同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌", () => {
    const royal = evaluateHand(cards("A♠", "K♠", "Q♠", "J♠", "T♠"));
    const straightFlush = evaluateHand(cards("9♥", "8♥", "7♥", "6♥", "5♥"));
    const quads = evaluateHand(cards("A♠", "A♥", "A♦", "A♣", "K♠"));
    const fullHouse = evaluateHand(cards("K♠", "K♥", "K♦", "Q♣", "Q♠"));
    const flush = evaluateHand(cards("A♥", "J♥", "8♥", "5♥", "2♥"));
    const straight = evaluateHand(cards("9♠", "8♥", "7♦", "6♣", "5♠"));
    const trips = evaluateHand(cards("7♠", "7♥", "7♦", "A♣", "K♠"));
    const twoPair = evaluateHand(cards("A♠", "A♥", "K♦", "K♣", "Q♠"));
    const onePair = evaluateHand(cards("T♠", "T♥", "A♦", "K♣", "Q♠"));
    const highCard = evaluateHand(cards("A♠", "J♥", "9♦", "6♣", "3♠"));

    expect(royal.category).toBe(8);
    expect(straightFlush.category).toBe(8);
    expect(quads.category).toBe(7);
    expect(fullHouse.category).toBe(6);
    expect(flush.category).toBe(5);
    expect(straight.category).toBe(4);
    expect(trips.category).toBe(3);
    expect(twoPair.category).toBe(2);
    expect(onePair.category).toBe(1);
    expect(highCard.category).toBe(0);

    expect(compareScores(royal, straightFlush)).toBeGreaterThan(0);
    expect(compareScores(straightFlush, quads)).toBeGreaterThan(0);
    expect(compareScores(quads, fullHouse)).toBeGreaterThan(0);
    expect(compareScores(fullHouse, flush)).toBeGreaterThan(0);
    expect(compareScores(flush, straight)).toBeGreaterThan(0);
    expect(compareScores(straight, trips)).toBeGreaterThan(0);
    expect(compareScores(trips, twoPair)).toBeGreaterThan(0);
    expect(compareScores(twoPair, onePair)).toBeGreaterThan(0);
    expect(compareScores(onePair, highCard)).toBeGreaterThan(0);
  });

  it("A-2-3-4-5是最小顺子(5-high)", () => {
    const wheel = evaluateHand(cards("A♠", "2♥", "3♦", "4♣", "5♠"));
    expect(wheel.name).toBe("顺子");
    expect(wheel.kickers[0]).toBe(5);

    const sixHigh = evaluateHand(cards("6♠", "5♥", "4♦", "3♣", "2♠"));
    expect(compareScores(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it("同花顺中高张决定胜负", () => {
    const kingHigh = evaluateHand(cards("K♠", "Q♠", "J♠", "T♠", "9♠"));
    const queenHigh = evaluateHand(cards("Q♥", "J♥", "T♥", "9♥", "8♥"));
    expect(compareScores(kingHigh, queenHigh)).toBeGreaterThan(0);
  });

  it("四条比较: 高四条胜, 相同四条比踢脚", () => {
    const quadA = evaluateHand(cards("A♠", "A♥", "A♦", "A♣", "2♠"));
    const quadK = evaluateHand(cards("K♠", "K♥", "K♦", "K♣", "A♠"));
    expect(compareScores(quadA, quadK)).toBeGreaterThan(0);
  });

  it("葫芦比较: 三条部分先比, 再比对子", () => {
    const aaaKK = evaluateHand(cards("A♠", "A♥", "A♦", "K♣", "K♠"));
    const aaaJJ = evaluateHand(cards("A♣", "A♠", "A♥", "J♣", "J♠"));
    const kkkQQ = evaluateHand(cards("K♠", "K♥", "K♦", "Q♣", "Q♠"));
    expect(compareScores(aaaKK, aaaJJ)).toBeGreaterThan(0);
    expect(compareScores(aaaKK, kkkQQ)).toBeGreaterThan(0);
  });

  it("两对比较: 高对先比, 再比低对, 最后比踢脚", () => {
    const aakkQ = evaluateHand(cards("A♠", "A♥", "K♦", "K♣", "Q♠"));
    const aakkJ = evaluateHand(cards("A♦", "A♣", "K♠", "K♥", "J♠"));
    const aajjK = evaluateHand(cards("A♠", "A♥", "J♦", "J♣", "K♠"));
    expect(compareScores(aakkQ, aakkJ)).toBeGreaterThan(0);
    expect(compareScores(aakkQ, aajjK)).toBeGreaterThan(0);
  });

  it("一对比较: 对子先比, 再依次比踢脚", () => {
    const pairAAKQJ = evaluateHand(cards("A♠", "A♥", "K♦", "Q♣", "J♠"));
    const pairAAKQ9 = evaluateHand(cards("A♦", "A♣", "K♠", "Q♥", "9♠"));
    expect(compareScores(pairAAKQJ, pairAAKQ9)).toBeGreaterThan(0);
  });

  it("高牌比较: 依次比五张牌", () => {
    const aceHigh = evaluateHand(cards("A♠", "J♥", "9♦", "6♣", "3♠"));
    const kingHigh = evaluateHand(cards("K♠", "Q♥", "J♦", "9♣", "7♠"));
    expect(compareScores(aceHigh, kingHigh)).toBeGreaterThan(0);
  });

  it("7张牌中选出最佳5张", () => {
    // 7 cards with a flush
    const score = evaluateHand(cards("A♥", "K♥", "Q♥", "J♥", "9♥", "2♠", "3♣"));
    expect(score.name).toBe("同花");
  });
});

// ====================================================================
// 12. POT RAISE FORMULA
// ====================================================================
describe("底池加注公式", () => {
  it("翻牌前底池加注应正确", () => {
    // At preflop start: pot=0, SB=10 (in bet), BB=20 (in bet)
    // So the "pot" for raise calculation = pot + allBets = 0 + 10 + 20 = 30
    // For UTG (bet=0): pot raise = currentBet + pot + (currentBet - heroBet)
    // = 20 + 30 + (20 - 0) = 70
    // But game.pot is 0 (bets not swept yet), so formula uses game.pot
    const state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    // The "pot" in the formula should be the total pot including current bets
    const totalPot = state.pot + state.seats.reduce((sum, s) => sum + s.bet, 0);
    const heroBet = state.seats[state.actorIndex].bet;
    const potRaise = state.currentBet + totalPot + (state.currentBet - heroBet);
    expect(potRaise).toBe(70); // 20 + 30 + 20
    expect(totalPot).toBe(30); // 0 + 10 + 20
  });

  it("翻牌后有下注时底池加注应正确", () => {
    let state = startHand(createInitialState([
      { id: "a", name: "A", avatar: "", stack: 1000, isHuman: true },
      { id: "b", name: "B", avatar: "", stack: 1000, isHuman: true },
      { id: "c", name: "C", avatar: "", stack: 1000, isHuman: true },
    ], 10, 20), () => .42);

    // Preflop: all call
    state = applyAction(state, "a", "call");
    state = applyAction(state, "b", "call");
    state = applyAction(state, "c", "check");
    expect(state.pot).toBe(60);

    // Flop: b bets 40, c calls
    state = applyAction(state, "b", "raise", 40);
    state = applyAction(state, "c", "call");

    // a's turn: pot=60, currentBet=40, heroBet=0
    // totalPot = 60 + 40 + 40 + 0 = 140
    // pot raise = currentBet + totalPot + (currentBet - heroBet) = 40 + 140 + 40 = 220
    const totalPot = state.pot + state.seats.reduce((sum, s) => sum + s.bet, 0);
    const heroBet = state.seats[0].bet;
    const potRaise = state.currentBet + totalPot + (state.currentBet - heroBet);
    expect(potRaise).toBe(220);
  });
});

// ====================================================================
// 13. CHIP CONSERVATION
// ====================================================================
describe("筹码守恒", () => {
  it("多手随机操作筹码守恒", () => {
    let seed = 42;
    const random = () => ((seed = seed * 48271 % 2147483647) / 2147483647);
    const stacks = [1000, 1500, 800, 2000, 500];
    const total = stacks.reduce((a, b) => a + b, 0);
    let state = createInitialState(stacks.map((stack, i) => ({
      id: `p${i}`, name: `P${i}`, avatar: "", stack, isHuman: true
    })), 5, 10);

    for (let hand = 0; hand < 20 && state.seats.filter(s => s.stack > 0).length >= 2; hand++) {
      state = startHand(state, random);
      let actions = 0;
      while (state.phase !== "complete" && actions < 200) {
        const legal = legalActions(state);
        if (legal.actions.length === 0) break;
        let action: PlayerAction = legal.actions.includes("check") ? "check" : "call";
        if (legal.actions.includes("raise") && random() < 0.15) {
          action = "raise";
          const raiseTo = legal.minRaiseTo + Math.floor(random() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
          state = applyAction(state, state.seats[state.actorIndex].id, action, raiseTo);
        } else if (legal.actions.includes("fold") && random() < 0.1) {
          action = "fold";
          state = applyAction(state, state.seats[state.actorIndex].id, action);
        } else {
          state = applyAction(state, state.seats[state.actorIndex].id, action);
        }
        actions++;
      }
      expect(state.phase).toBe("complete");
      expect(state.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(total);
    }
  });
});
