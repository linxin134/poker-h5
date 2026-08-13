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
  leave(): void;
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
    // A room boundary invalidates every seat-keyed transient.  Preserve them
    // only for a reconnect to the same active room; ordinary room snapshots
    // must never clear an effect that is currently on screen.
    if (activeCode && activeCode !== code) useGameStore.getState().clearTransientUi();
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
        useGameStore.getState().receiveEmoji({
          id: message.id,
          kind: message.kind,
          emoji: message.emoji,
          from: message.fromSeatId,
          to: message.kind === "interaction" ? message.targetSeatId : undefined,
          createdAt: message.createdAt
        });
        return;
      }
      if (message.type === "chat") {
        useGameStore.getState().receiveChatBubble(message.id, message.text, message.userId, message.seatId, message.createdAt);
        return;
      }
      if (message.type === "left") {
        get().disconnect();
        useGameStore.getState().setScreen("lobby");
        return;
      }
      if (message.type === "dissolved") {
        manualClose = true;
        activeCode = "";
        window.sessionStorage.removeItem("poker-active-room");
        set({ room: null, connectionStatus: "idle", error: message.message });
        useGameStore.getState().setScreen("lobby");
        useGameStore.getState().clearTransientUi();
        socket?.close();
        return;
      }
      if (message.type === "error") {
        const terminal = message.message.includes("房间不存在") || message.message.includes("不在这个房间") || message.message.includes("请先登录");
        if (terminal) {
          manualClose = true;
          activeCode = "";
          window.sessionStorage.removeItem("poker-active-room");
          set({ room: null, connectionStatus: "error", error: message.message });
          useGameStore.getState().setScreen("lobby");
          useGameStore.getState().clearTransientUi();
          socket?.close();
          return;
        }
        set({ error: message.message });
      }
    });
    socket.addEventListener("close", (event) => {
      if (manualClose) return;
      // A disconnected socket cannot guarantee that seat ids still refer to
      // the same members; clear transient seat UI before reconnecting.
      useGameStore.getState().clearTransientUi();
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
    useGameStore.getState().clearTransientUi();
    set({ room: null, connectionStatus: "idle", error: null });
  },

  leave: () => {
    if (socket?.readyState !== WebSocket.OPEN) {
      get().disconnect();
      useGameStore.getState().setScreen("lobby");
      return;
    }
    socket.send(JSON.stringify({ type: "leave" } satisfies RoomClientMessage));
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
