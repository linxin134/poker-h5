import Dexie, { type EntityTable } from "dexie";
import type { PokerState } from "../game/types";

export interface LocalSave {
  id: "active";
  state: PokerState;
  updatedAt: number;
}

export interface ReplayRecord {
  id: string;
  handNumber: number;
  state: PokerState;
  createdAt: number;
}

class PokerDatabase extends Dexie {
  saves!: EntityTable<LocalSave, "id">;
  replays!: EntityTable<ReplayRecord, "id">;

  constructor() {
    super("night-stack-poker");
    this.version(1).stores({ saves: "id,updatedAt", replays: "id,handNumber,createdAt" });
  }
}

export const localDb = new PokerDatabase();

export async function saveLocalGame(state: PokerState) {
  await localDb.saves.put({ id: "active", state, updatedAt: Date.now() });
}

export async function loadLocalGame() {
  return (await localDb.saves.get("active"))?.state;
}

export async function archiveReplay(state: PokerState) {
  await localDb.replays.put({ id: state.handId, handNumber: state.handNumber, state, createdAt: Date.now() });
}
