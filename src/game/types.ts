export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = `${Rank}${Suit}`;
export type Phase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type PlayerAction = "fold" | "check" | "call" | "raise" | "all-in";

export interface Seat {
  id: string;
  userId?: string;
  position?: number;
  name: string;
  avatar: string;
  stack: number;
  holeCards: Card[];
  bet: number;
  totalContribution: number;
  folded: boolean;
  allIn: boolean;
  isHuman: boolean;
  connected?: boolean;
  standing?: boolean;
  holeCardCount?: number;
  lastAction?: string;
}

export interface ActionRecord {
  id: string;
  at: number;
  phase: Phase;
  seatId?: string;
  type: string;
  amount?: number;
  detail: string;
}

export interface GameEvent {
  id: string;
  type: "deal" | "chips" | "fold" | "turn" | "street" | "showdown" | "win" | "emoji";
  seatId?: string;
  targetSeatId?: string;
  payload?: Record<string, unknown>;
}

export interface HandResult {
  winnerSeatIds: string[];
  pot: number;
  reason: "fold" | "showdown";
  handName?: string;
}

export interface RoomSession {
  id: string;
  durationMinutes: 30 | 60;
  startedAt: number;
  endsAt: number;
  status: "active" | "finished";
}

export interface PokerState {
  handId: string;
  handNumber: number;
  startingStack: number;
  phase: Phase;
  seats: Seat[];
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  actorIndex: number;
  board: Card[];
  deck: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  actedThisRound: string[];
  history: ActionRecord[];
  events: GameEvent[];
  handStartStacks: Record<string, number>;
  winnerText?: string;
  result?: HandResult;
  room?: RoomSession;
}

export interface LegalActions {
  actions: PlayerAction[];
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}
