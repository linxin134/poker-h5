import type { PokerState } from "../game/types";
import type { RoomDurationMinutes, RoomHandRecord, RoomListItem, RoomView } from "../multiplayer/types";

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatar: string;
}

export interface UserHandHistory extends RoomHandRecord {
  roomCode: string;
}

export interface UserRoomHistory {
  roomCode: string;
  handCount: number;
  completedAt: number;
  scoreboard: Array<{ userId?: string; nickname: string; avatar: string; delta: number; finalStack: number }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...init?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "请求失败");
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/auth/me"),
  register: (email: string, password: string, nickname: string) => request<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, nickname }) }),
  login: (email: string, password: string) => request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  updateProfile: (nickname: string, avatar: string) => request<{ user: User }>("/profile", { method: "PUT", body: JSON.stringify({ nickname, avatar }) }),
  pushSave: (state: PokerState) => request<{ savedAt: number }>("/save", { method: "PUT", body: JSON.stringify({ state }) }),
  pullSave: () => request<{ state: PokerState | null; savedAt: number | null }>("/save"),
  pushStats: (payload: Record<string, number>) => request<{ ok: true }>("/stats", { method: "POST", body: JSON.stringify(payload) }),
  stats: () => request<{ hands: number; wins: number; profit: number; biggestPot: number }>("/stats"),
  history: () => request<{ hands: UserHandHistory[]; rooms: UserRoomHistory[] }>("/history"),
  createRoom: (options: { durationMinutes: RoomDurationMinutes; capacity: number; startingStack: number; smallBlind: number; bigBlind: number }) => request<{ code: string }>("/rooms", { method: "POST", body: JSON.stringify(options) }),
  rooms: () => request<{ rooms: RoomListItem[] }>("/rooms"),
  joinRoom: (code: string) => request<{ code: string }>(`/rooms/${encodeURIComponent(code)}/join`, { method: "POST" }),
  room: (code: string) => request<{ room: RoomView }>(`/rooms/${encodeURIComponent(code)}`)
};
