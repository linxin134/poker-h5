import type { Card, Rank, Suit } from "./types";

export const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
export const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}` as Card));
}

export function shuffleDeck(cards = createDeck(), random = Math.random): Card[] {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const rankValue = (card: Card) => RANKS.indexOf(card[0] as Rank) + 2;

export interface HandScore {
  category: number;
  name: string;
  kickers: number[];
  cards: Card[];
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  const result: T[][] = [];
  for (let i = 0; i <= items.length - count; i += 1) {
    for (const tail of combinations(items.slice(i + 1), count - 1)) result.push([items[i], ...tail]);
  }
  return result;
}

function scoreFive(cards: Card[]): HandScore {
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const suits = cards.map((card) => card.slice(1));
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(values)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) { straightHigh = unique[i]; break; }
  }
  const flush = new Set(suits).size === 1;
  if (flush && straightHigh) return { category: 8, name: straightHigh === 14 ? "皇家同花顺" : "同花顺", kickers: [straightHigh], cards };
  if (groups[0][1] === 4) return { category: 7, name: "四条", kickers: [groups[0][0], groups[1][0]], cards };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 6, name: "葫芦", kickers: [groups[0][0], groups[1][0]], cards };
  if (flush) return { category: 5, name: "同花", kickers: values, cards };
  if (straightHigh) return { category: 4, name: "顺子", kickers: [straightHigh], cards };
  if (groups[0][1] === 3) return { category: 3, name: "三条", kickers: [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)], cards };
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
    const kicker = groups.find((g) => g[1] === 1)?.[0] ?? 0;
    return { category: 2, name: "两对", kickers: [...pairs, kicker], cards };
  }
  if (groups[0][1] === 2) return { category: 1, name: "一对", kickers: [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)], cards };
  return { category: 0, name: "高牌", kickers: values, cards };
}

export function compareScores(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i += 1) {
    if ((a.kickers[i] ?? 0) !== (b.kickers[i] ?? 0)) return (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
  }
  return 0;
}

export function evaluateHand(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("至少需要五张牌");
  return combinations(cards, 5).map(scoreFive).sort((a, b) => compareScores(b, a))[0];
}

export const cardLabel = (card: Card) => card.replace("T", "10");
