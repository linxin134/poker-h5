import { describe, expect, it } from "vitest";
import { compareScores, evaluateHand } from "../src/game/cards";
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
});
