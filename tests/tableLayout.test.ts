import { describe, expect, it } from "vitest";
import { anchoredSeatPoint } from "../src/game/tableLayout";

describe("mobile table seat layout", () => {
  it.each([3, 6, 8, 9])("anchors the local player and aligns side seats for %i seats", (capacity) => {
    expect(anchoredSeatPoint(0, capacity)).toEqual({ x: 50, y: 78 });
    const points = Array.from({ length: capacity - 1 }, (_, index) => anchoredSeatPoint(index + 1, capacity));
    expect(points.filter((point) => point.x < 50).every((point) => point.x === 12)).toBe(true);
    expect(points.filter((point) => point.x > 50).every((point) => point.x === 88)).toBe(true);
  });

  it("keeps the eight-seat top opponent centered", () => {
    expect(anchoredSeatPoint(4, 8)).toEqual({ x: 50, y: 14 });
  });
});
