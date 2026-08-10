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
}

export interface RoomHandSeatResult {
  seatId: string;
  nickname: string;
  avatar: string;
  cards: Card[];
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
  | { type: "sit"; seatIndex: number }
  | { type: "action"; action: PlayerAction; raiseTo?: number }
  | { type: "emoji"; emoji: string; targetSeatId: string }
  | { type: "ping" };

export type RoomServerMessage =
  | { type: "room"; room: RoomView }
  | { type: "emoji"; id: string; emoji: string; fromSeatId: string; targetSeatId: string }
  | { type: "error"; message: string }
  | { type: "pong"; at: number };
