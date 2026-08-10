import type { Seat } from "./types";

export interface SidePot {
  amount: number;
  eligibleSeatIds: string[];
}

export function buildSidePots(seats: Seat[]): SidePot[] {
  const levels = [...new Set(seats.map((seat) => seat.totalContribution).filter((value) => value > 0))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = seats.filter((seat) => seat.totalContribution >= level);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) {
      pots.push({ amount, eligibleSeatIds: contributors.filter((seat) => !seat.folded).map((seat) => seat.id) });
    }
    previous = level;
  }
  return pots;
}
