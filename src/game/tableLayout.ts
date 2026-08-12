export interface TableSeatPoint {
  x: number;
  y: number;
}

export function relativeSeatPosition(position: number, anchorPosition: number, capacity: number) {
  const normalizedCapacity = Math.max(3, Math.round(capacity));
  return ((Math.round(position) - Math.round(anchorPosition)) % normalizedCapacity + normalizedCapacity) % normalizedCapacity;
}

/**
 * Anchors the local player at the bottom and distributes every side seat on
 * two mirrored vertical rails. The top and bottom anchors intentionally use
 * the same inset so every player's chosen seat rotates into one stable,
 * symmetrical perspective.
 */
export function anchoredSeatPoint(relativePosition: number, capacity: number): TableSeatPoint {
  const normalizedCapacity = Math.max(3, Math.round(capacity));
  const relative = ((Math.round(relativePosition) % normalizedCapacity) + normalizedCapacity) % normalizedCapacity;
  const edgeInset = 14 * (2 / 3);
  const bottomInset = 100 - edgeInset;
  if (relative === 0) return { x: 50, y: bottomInset };

  const hasTopSeat = normalizedCapacity % 2 === 0;
  const sideCount = hasTopSeat ? (normalizedCapacity - 2) / 2 : (normalizedCapacity - 1) / 2;
  const topPosition = hasTopSeat ? normalizedCapacity / 2 : -1;
  if (relative === topPosition) return { x: 50, y: edgeInset };

  const isLeft = relative <= sideCount;
  const railIndex = isLeft ? relative - 1 : normalizedCapacity - relative - 1;
  const railStep = (bottomInset - edgeInset) / (sideCount + 1);
  const y = bottomInset - railStep * (railIndex + 1);
  return { x: isLeft ? 12 : 88, y };
}
