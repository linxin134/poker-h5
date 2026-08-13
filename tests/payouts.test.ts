import { describe, expect, it } from "vitest";
import { buildPotAwardTargets } from "../src/game/payouts";

describe("pot award targets", () => {
  it("uses exact main/side-pot payouts instead of averaging the total pot", () => {
    const targets = buildPotAwardTargets({
      winnerSeatIds:["a", "b"],
      pot:700,
      reason:"showdown",
      payouts:[{ seatId:"a", amount:300 }, { seatId:"b", amount:400 }]
    }, (seatId) => seatId === "a" ? { x:20, y:40 } : { x:80, y:40 });

    expect(targets).toEqual([
      { id:"a", amount:300, x:20, y:40 },
      { id:"b", amount:400, x:80, y:40 }
    ]);
  });

  it("preserves the exact 8/7 odd-chip split", () => {
    const targets = buildPotAwardTargets({
      winnerSeatIds:["a", "b"],
      pot:15,
      reason:"showdown",
      payouts:[{ seatId:"b", amount:8 }, { seatId:"a", amount:7 }]
    }, () => ({ x:50, y:50 }));

    expect(targets.map(({ id, amount }) => ({ id, amount }))).toEqual([
      { id:"b", amount:8 },
      { id:"a", amount:7 }
    ]);
    expect(targets.reduce((sum, target) => sum + target.amount, 0)).toBe(15);
  });

  it("keeps rendering a legacy in-flight result without payout details", () => {
    expect(buildPotAwardTargets({
      winnerSeatIds:["a"], pot:20, reason:"fold"
    }, () => ({ x:50, y:80 }))).toEqual([{ id:"a", amount:20, x:50, y:80 }]);
  });
});
