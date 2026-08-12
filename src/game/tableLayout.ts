export interface TableSeatPoint {
  x: number;
  y: number;
}

export function relativeSeatPosition(position: number, anchorPosition: number, capacity: number) {
  const normalizedCapacity = Math.max(3, Math.round(capacity));
  return ((Math.round(position) - Math.round(anchorPosition)) % normalizedCapacity + normalizedCapacity) % normalizedCapacity;
}

/**
 * Anchors the local player at the bottom and keeps every side seat on one of
 * two vertical rails. This leaves the board and action area unobstructed.
 */
export function anchoredSeatPoint(relativePosition: number, capacity: number): TableSeatPoint {
  const normalizedCapacity = Math.max(3, Math.round(capacity));
  const relative = ((Math.round(relativePosition) % normalizedCapacity) + normalizedCapacity) % normalizedCapacity;
  // Reserve the bottom safe area for hole cards, showdown labels and browser
  // controls. Waiting and active tables both consume this same coordinate.
  if (relative === 0) return { x: 50, y: 78 };

  const hasTopSeat = normalizedCapacity % 2 === 0;
  const sideCount = hasTopSeat ? (normalizedCapacity - 2) / 2 : (normalizedCapacity - 1) / 2;
  const topPosition = hasTopSeat ? normalizedCapacity / 2 : -1;
  if (relative === topPosition) return { x: 50, y: 14 };

  const isLeft = relative <= sideCount;
  const railIndex = isLeft ? relative - 1 : normalizedCapacity - relative - 1;
  const topY = 19;
  // Keep the lowest side rail clear of the enlarged local action controls.
  // The local seat remains anchored at 78%; only adjacent opponents move up.
  const bottomY = 52;
  const y = sideCount <= 1 ? 45 : bottomY - railIndex * ((bottomY - topY) / (sideCount - 1));
  return { x: isLeft ? 12 : 88, y };
}
