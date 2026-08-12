import { describe, expect, it } from "vitest";
import { anchoredSeatPoint, MOBILE_SEAT_EDGE_INSET, relativeSeatPosition } from "../src/game/tableLayout";

describe("mobile table seat layout", () => {
  const edgeInset = MOBILE_SEAT_EDGE_INSET;
  const bottomInset = 100 - edgeInset;

  it.each([3, 6, 8, 9])("anchors the local player and aligns side seats for %i seats", (capacity) => {
    expect(anchoredSeatPoint(0, capacity)).toEqual({ x: 50, y: bottomInset });
    const points = Array.from({ length: capacity - 1 }, (_, index) => anchoredSeatPoint(index + 1, capacity));
    expect(points.filter((point) => point.x < 50).every((point) => point.x === 12)).toBe(true);
    expect(points.filter((point) => point.x > 50).every((point) => point.x === 88)).toBe(true);
  });

  it.each([4, 6, 8])("keeps the %i-seat top opponent centered at the reduced inset", (capacity) => {
    expect(anchoredSeatPoint(capacity / 2, capacity)).toEqual({ x: 50, y: edgeInset });
  });

  it.each([3, 4, 5, 6, 7, 8, 9])("distributes the %i-seat side rails evenly and symmetrically", (capacity) => {
    const hasTopSeat = capacity % 2 === 0;
    const sideCount = hasTopSeat ? (capacity - 2) / 2 : (capacity - 1) / 2;
    const left = Array.from({ length: sideCount }, (_, index) => anchoredSeatPoint(index + 1, capacity).y).sort((a, b) => a - b);
    const right = Array.from({ length: sideCount }, (_, index) => anchoredSeatPoint(capacity - index - 1, capacity).y).sort((a, b) => a - b);
    expect(right).toEqual(left);

    const railWithEdges = [edgeInset, ...left, bottomInset];
    const gaps = railWithEdges.slice(1).map((value, index) => value - railWithEdges[index]);
    gaps.forEach((gap) => expect(gap).toBeCloseTo(gaps[0], 8));
    if (hasTopSeat) {
      const allY = Array.from({ length: capacity }, (_, index) => anchoredSeatPoint(index, capacity).y);
      expect(Math.min(...allY) + Math.max(...allY)).toBeCloseTo(100, 8);
    }
  });

  it.each([3, 6, 8, 9])("rotates every possible chosen seat to the bottom anchor for %i seats", (capacity) => {
    for (let chosenSeat = 0; chosenSeat < capacity; chosenSeat += 1) {
      expect(relativeSeatPosition(chosenSeat, chosenSeat, capacity)).toBe(0);
      expect(anchoredSeatPoint(relativeSeatPosition(chosenSeat, chosenSeat, capacity), capacity)).toEqual({ x: 50, y: bottomInset });
      const rotated = Array.from({ length: capacity }, (_, seat) => relativeSeatPosition(seat, chosenSeat, capacity));
      expect(new Set(rotated).size).toBe(capacity);
    }
  });
});
