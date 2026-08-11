import { describe, expect, it } from "vitest";
import { compareScores, createDeck, evaluateHand, shuffleDeck } from "../src/game/cards";
import type { Card } from "../src/game/types";

const cards = (...values: Card[]) => values;

describe("evaluateHand", () => {
  it("识别皇家同花顺", () => {
    const score = evaluateHand(cards("A♠", "K♠", "Q♠", "J♠", "T♠", "2♦", "3♣"));
    expect(score.name).toBe("皇家同花顺");
  });

  it("识别 A2345 小顺子", () => {
    const score = evaluateHand(cards("A♠", "2♥", "3♦", "4♣", "5♠", "K♦", "Q♣"));
    expect(score.name).toBe("顺子");
    expect(score.kickers[0]).toBe(5);
  });

  it("四条大于葫芦", () => {
    const quads = evaluateHand(cards("A♠", "A♥", "A♦", "A♣", "2♠"));
    const fullHouse = evaluateHand(cards("K♠", "K♥", "K♦", "Q♣", "Q♠"));
    expect(compareScores(quads, fullHouse)).toBeGreaterThan(0);
  });

  it.each([
    ["同花顺", cards("9♠", "8♠", "7♠", "6♠", "5♠", "A♦", "K♣")],
    ["四条", cards("Q♠", "Q♥", "Q♦", "Q♣", "A♠", "3♦", "2♣")],
    ["葫芦", cards("J♠", "J♥", "J♦", "8♣", "8♠", "3♦", "2♣")],
    ["同花", cards("A♥", "J♥", "8♥", "5♥", "2♥", "K♣", "Q♦")],
    ["顺子", cards("9♠", "8♥", "7♦", "6♣", "5♠", "A♦", "K♣")],
    ["三条", cards("7♠", "7♥", "7♦", "A♣", "K♠", "3♦", "2♣")],
    ["两对", cards("A♠", "A♥", "K♦", "K♣", "Q♠", "3♦", "2♣")],
    ["一对", cards("T♠", "T♥", "A♦", "K♣", "Q♠", "3♦", "2♣")],
    ["高牌", cards("A♠", "J♥", "9♦", "6♣", "3♠", "2♦", "4♣")]
  ])("从七张牌选出最佳%s", (name, hand) => {
    expect(evaluateHand(hand).name).toBe(name);
  });

  it("按对子、踢脚与顺子高张正确比较同类牌", () => {
    const acesKing = evaluateHand(cards("A♠", "A♥", "K♦", "Q♣", "9♠", "3♦", "2♣"));
    const acesQueen = evaluateHand(cards("A♦", "A♣", "Q♦", "J♣", "9♥", "3♠", "2♥"));
    const sixHighStraight = evaluateHand(cards("6♠", "5♥", "4♦", "3♣", "2♠"));
    const wheel = evaluateHand(cards("A♠", "5♦", "4♥", "3♦", "2♣"));
    expect(compareScores(acesKing, acesQueen)).toBeGreaterThan(0);
    expect(compareScores(sixHighStraight, wheel)).toBeGreaterThan(0);
  });

  it("一副牌恰好 52 张且洗牌不增删牌", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck, () => .37);
    expect(deck).toHaveLength(52);
    expect(new Set(deck)).toHaveLength(52);
    expect(new Set(shuffled)).toEqual(new Set(deck));
  });

  it("少于五张牌时拒绝评估", () => {
    expect(() => evaluateHand(cards("A♠", "K♠", "Q♠", "J♠"))).toThrow("至少需要五张牌");
  });
});
