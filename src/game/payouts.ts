import type { HandResult } from "./types";

export interface PotAwardTarget {
  id: string;
  amount: number;
  x: number;
  y: number;
}

/** Build animation targets from the server-authoritative settlement amounts. */
export function buildPotAwardTargets(
  result: HandResult | undefined,
  pointForSeat: (seatId: string) => { x: number; y: number } | undefined
): PotAwardTarget[] {
  if (!result) return [];
  const payouts = result.payouts ?? (() => {
    if (result.winnerSeatIds.length === 0) return [];
    const share = Math.floor(result.pot / result.winnerSeatIds.length);
    return result.winnerSeatIds.map((seatId, index) => ({
      seatId,
      amount:share + (index < result.pot % result.winnerSeatIds.length ? 1 : 0)
    }));
  })();
  return payouts.flatMap((payout) => {
    const point = pointForSeat(payout.seatId);
    return point && payout.amount > 0 ? [{ id: payout.seatId, amount: payout.amount, ...point }] : [];
  });
}
