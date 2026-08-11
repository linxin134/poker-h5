import { describe, expect, it } from "vitest";
import { anchoredSeatPoint, relativeSeatPosition } from "../src/game/tableLayout";

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

  it.each([3, 6, 8, 9])("rotates every possible chosen seat to the bottom anchor for %i seats", (capacity) => {
    for (let chosenSeat = 0; chosenSeat < capacity; chosenSeat += 1) {
      expect(relativeSeatPosition(chosenSeat, chosenSeat, capacity)).toBe(0);
      expect(anchoredSeatPoint(relativeSeatPosition(chosenSeat, chosenSeat, capacity), capacity)).toEqual({ x: 50, y: 78 });
      const rotated = Array.from({ length: capacity }, (_, seat) => relativeSeatPosition(seat, chosenSeat, capacity));
      expect(new Set(rotated).size).toBe(capacity);
    }
  });
});
