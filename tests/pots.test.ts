import { describe, expect, it } from "vitest";
import { buildSidePots } from "../src/game/pots";
import type { Seat } from "../src/game/types";

const seat = (id: string, contribution: number, folded = false): Seat => ({ id, name: id, avatar: "", stack: 0, holeCards: [], bet: 0, totalContribution: contribution, folded, allIn: true, isHuman: false });

describe("buildSidePots", () => {
  it("构建主池和两个边池", () => {
    const pots = buildSidePots([seat("a", 100), seat("b", 300), seat("c", 500)]);
    expect(pots.map((pot) => pot.amount)).toEqual([300, 400, 200]);
    expect(pots[0].eligibleSeatIds).toEqual(["a", "b", "c"]);
    expect(pots[2].eligibleSeatIds).toEqual(["c"]);
  });

  it("弃牌玩家仍贡献底池但不能获胜", () => {
    const pots = buildSidePots([seat("a", 100, true), seat("b", 100)]);
    expect(pots[0]).toEqual({ amount: 200, eligibleSeatIds: ["b"] });
  });

  it("相同投入只生成一个底池", () => {
    expect(buildSidePots([seat("a", 250), seat("b", 250), seat("c", 250)])).toEqual([
      { amount: 750, eligibleSeatIds: ["a", "b", "c"] }
    ]);
  });

  it("零投入玩家不会制造空边池", () => {
    expect(buildSidePots([seat("a", 0), seat("b", 100), seat("c", 100)])).toEqual([
      { amount: 200, eligibleSeatIds: ["b", "c"] }
    ]);
  });
});
