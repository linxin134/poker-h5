import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyAction, createInitialState, legalActions, startHand } from "../game/engine";
import type { PlayerAction, PokerState } from "../game/types";
import { archiveReplay, loadLocalGame, saveLocalGame } from "../services/localDb";
import { createUuid } from "../lib/uuid";

export type Screen = "lobby" | "table";
export interface GameSettings {
  music: number;
  sound: number;
  animationSpeed: number;
  effectQuality: "low" | "high";
  autoNextHand: boolean;
  tutorialHints: boolean;
  fastMode: boolean;
}

interface GameStore {
  screen: Screen;
  game: PokerState;
  settings: GameSettings;
  emojiBursts: Array<{ id: string; emoji: string; from: string; to: string }>;
  setScreen(screen: Screen): void;
  restoreGame(game: PokerState): void;
  newGame(options?: { seats?: number; stack?: number; smallBlind?: number; bigBlind?: number; durationMinutes?: 30 | 60 }): void;
  continueGame(): Promise<boolean>;
  startNextHand(): void;
  act(action: PlayerAction, raiseTo?: number): void;
  sendEmoji(emoji: string, target: string): void;
  receiveEmoji(id: string, emoji: string, from: string, target: string): void;
  clearEmoji(id: string): void;
  updateSettings(settings: Partial<GameSettings>): void;
}

const names = ["你", "北风", "小满", "拾柒", "可乐", "山鬼", "木星", "阿梨", "南星"];
const avatars = ["🦊", "🐼", "🦁", "🐸", "🐯", "🐰", "🦄", "🐨", "🐧"];

function makeGame(count = 6, stack = 2000, smallBlind = 10, bigBlind = 20) {
  return createInitialState(Array.from({ length: count }, (_, index) => ({
    id: `seat-${index}`,
    name: names[index],
    avatar: avatars[index],
    stack,
    isHuman: index === 0
  })), smallBlind, bigBlind);
}

export const useGameStore = create<GameStore>()(persist((set, get) => ({
  screen: "lobby",
  game: makeGame(),
  settings: { music: 0.35, sound: 0.8, animationSpeed: 1, effectQuality: "high", autoNextHand: false, tutorialHints: true, fastMode: false },
  emojiBursts: [],
  setScreen: (screen) => set({ screen }),
  restoreGame: (game) => { set({ game, screen: "table" }); void saveLocalGame(game); },
  newGame: (options) => {
    const now = Date.now();
    const durationMinutes = options?.durationMinutes ?? 30;
    const base = makeGame(options?.seats, options?.stack, options?.smallBlind, options?.bigBlind);
    base.room = {
      id: `NC-${createUuid().slice(0, 4).toUpperCase()}`,
      durationMinutes,
      startedAt: now,
      endsAt: now + durationMinutes * 60_000,
      status: "active"
    };
    const game = startHand(base);
    set({ game, screen: "table" });
    void saveLocalGame(game);
  },
  continueGame: async () => {
    const game = await loadLocalGame();
    if (!game) return false;
    set({ game, screen: "table" });
    return true;
  },
  startNextHand: () => {
    const previous = get().game;
    void archiveReplay(previous);
    const roomExpired = previous.room && Date.now() >= previous.room.endsAt;
    const tableFinished = previous.seats.filter((seat) => seat.stack > 0).length < 2;
    if (roomExpired || tableFinished) {
      const game = structuredClone(previous);
      if (game.room) game.room.status = "finished";
      set({ game });
      void saveLocalGame(game);
      return;
    }
    const game = startHand(previous);
    set({ game });
    void saveLocalGame(game);
  },
  act: (action, raiseTo) => {
    const current = get().game;
    const actor = current.seats[current.actorIndex];
    if (!actor) return;
    const game = applyAction(current, actor.id, action, raiseTo);
    set({ game });
    void saveLocalGame(game);
  },
  sendEmoji: (emoji, target) => {
    const burst = { id: createUuid(), emoji, from: "seat-0", to: target };
    set((state) => ({ emojiBursts: [...state.emojiBursts, burst] }));
  },
  receiveEmoji: (id, emoji, from, to) => set((state) => {
    if (state.emojiBursts.some((burst) => burst.id === id)) return state;
    return { emojiBursts: [...state.emojiBursts, { id, emoji, from, to }].slice(-6) };
  }),
  clearEmoji: (id) => set((state) => ({ emojiBursts: state.emojiBursts.filter((item) => item.id !== id) })),
  updateSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } }))
}), {
  name: "night-stack-settings",
  partialize: (state) => ({ settings: state.settings })
}));

export const selectLegalActions = (state: GameStore) => legalActions(state.game);
