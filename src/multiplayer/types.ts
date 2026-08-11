import type { Card, PlayerAction, PokerState } from "../game/types";

export type RoomDurationMinutes = 30 | 60;
export type RoomStatus = "waiting" | "playing" | "finished";

export interface RoomMember {
  userId: string;
  seatId: string;
  seatIndex: number | null;
  nickname: string;
  avatar: string;
  connected: boolean;
  isHost: boolean;
  buyIn: number;
  topUpTarget: number | null;
  standAfterHand: boolean;
  standingNow: boolean;
  savedStack: number | null;
}

export interface RoomHandSeatResult {
  userId?: string;
  seatId: string;
  nickname: string;
  avatar: string;
  cards: Array<Card | null>;
  handName?: string;
  showedDown: boolean;
  delta: number;
  finalStack: number;
  folded: boolean;
  won: boolean;
}

export interface RoomHandRecord {
  id: string;
  handNumber: number;
  board: Card[];
  pot: number;
  winnerText: string;
  seats: RoomHandSeatResult[];
  completedAt: number;
}

export interface RoomScoreEntry {
  seatId: string;
  nickname: string;
  avatar: string;
  stack: number;
  delta: number;
  connected: boolean;
}

export interface RoomChatMessage {
  id: string;
  userId: string;
  seatId: string;
  nickname: string;
  avatar: string;
  text: string;
  createdAt: number;
}

export interface RoomView {
  code: string;
  hostUserId: string;
  status: RoomStatus;
  durationMinutes: RoomDurationMinutes;
  capacity: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  startedAt: number | null;
  endsAt: number | null;
  turnEndsAt: number | null;
  nextHandAt: number | null;
  mySeatId: string;
  members: RoomMember[];
  game: PokerState | null;
  hands: RoomHandRecord[];
  scoreboard: RoomScoreEntry[];
  chatMessages: RoomChatMessage[];
}

export interface RoomListItem {
  code: string;
  hostNickname: string;
  hostAvatar: string;
  status: RoomStatus;
  handNumber: number;
  durationMinutes: RoomDurationMinutes;
  capacity: number;
  memberCount: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  createdAt: number;
}

export type RoomClientMessage =
  | { type: "start" }
  | { type: "dissolve" }
  | { type: "sit"; seatIndex: number }
  | { type: "stand" }
  | { type: "action"; action: PlayerAction; raiseTo?: number }
  | { type: "revealCard"; cardIndex: number }
  | { type: "emoji"; emoji: string; targetSeatId: string }
  | { type: "chat"; text: string }
  | { type: "topup"; targetStack: number }
  | { type: "ping" };

export type RoomServerMessage =
  | { type: "room"; room: RoomView }
  | { type: "dissolved"; message: string }
  | { type: "emoji"; id: string; emoji: string; fromSeatId: string; targetSeatId: string }
  | { type: "error"; message: string }
  | { type: "pong"; at: number };
