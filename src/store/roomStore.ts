import { create } from "zustand";
import type { RoomClientMessage, RoomServerMessage, RoomView } from "../multiplayer/types";
import { useGameStore } from "./gameStore";

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

interface RoomStore {
  room: RoomView | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
  connect(code: string): void;
  disconnect(): void;
  send(message: RoomClientMessage): void;
  clearError(): void;
}

let socket: WebSocket | null = null;
let activeCode = "";
let manualClose = false;
let reconnectTimer: number | undefined;

function socketUrl(code: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/rooms/${encodeURIComponent(code)}/socket`;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  room: null,
  connectionStatus: "idle",
  error: null,

  connect: (codeInput) => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    manualClose = false;
    activeCode = code;
    window.sessionStorage.setItem("poker-active-room", code);
    socket?.close();
    set((state) => ({ connectionStatus: state.room ? "reconnecting" : "connecting", error: null }));
    socket = new WebSocket(socketUrl(code));
    socket.addEventListener("open", () => set({ connectionStatus: "connected", error: null }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as RoomServerMessage;
      if (message.type === "room") {
        set({ room: message.room, connectionStatus: "connected", error: null });
        return;
      }
      if (message.type === "emoji") {
        useGameStore.getState().receiveEmoji(message.id, message.emoji, message.fromSeatId, message.targetSeatId);
        return;
      }
      if (message.type === "error") set({ error: message.message });
    });
    socket.addEventListener("close", (event) => {
      if (manualClose) return;
      if (event.code === 1008) {
        set({ connectionStatus: "error", error: get().error ?? "房间连接失败" });
        return;
      }
      set({ connectionStatus: "reconnecting" });
      reconnectTimer = window.setTimeout(() => get().connect(activeCode), 1_200);
    });
    socket.addEventListener("error", () => set({ connectionStatus: "error", error: "实时连接异常，正在重试" }));
  },

  disconnect: () => {
    manualClose = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
    activeCode = "";
    window.sessionStorage.removeItem("poker-active-room");
    set({ room: null, connectionStatus: "idle", error: null });
  },

  send: (message) => {
    if (socket?.readyState !== WebSocket.OPEN) {
      set({ error: "正在重新连接房间" });
      return;
    }
    socket.send(JSON.stringify(message));
  },

  clearError: () => set({ error: null })
}));
