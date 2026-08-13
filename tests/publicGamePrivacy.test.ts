import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../server/db";
import { roomService } from "../server/rooms";
import type { SafeUser } from "../server/auth";
import type { RoomServerMessage } from "../src/multiplayer/types";

class TestSocket {
  readyState = 1;
  messages: RoomServerMessage[] = [];

  send(data: string) {
    this.messages.push(JSON.parse(data) as RoomServerMessage);
  }
}

function makeUser(label: string): SafeUser {
  const id = randomUUID();
  const user = {
    id,
    email: `${id}@privacy.test`,
    nickname: label,
    avatar: label
  };
  db.prepare("INSERT INTO users (id,email,password_hash,nickname,avatar,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, "test-only", user.nickname, user.avatar, Date.now());
  return user;
}

function latestRoomMessage(socket: TestSocket) {
  const message = [...socket.messages].reverse().find((entry) => entry.type === "room");
  if (!message || message.type !== "room") throw new Error("expected a room broadcast");
  return message.room;
}

describe("public multiplayer game privacy", () => {
  const cleanupRooms: Array<() => void> = [];

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const cleanup of cleanupRooms.splice(0)) cleanup();
    db.prepare("DELETE FROM users WHERE email LIKE ?").run("%@privacy.test");
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("never exposes the server deck in REST views or WebSocket room payloads on any street", () => {
    const host = makeUser("host");
    const guest = makeUser("guest");
    const { code } = roomService.create(host, {
      durationMinutes: 30,
      capacity: 3,
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2
    });
    roomService.join(code, guest);

    const hostSocket = new TestSocket();
    const guestSocket = new TestSocket();
    const hostConnection = roomService.connect(code, host, hostSocket);
    const guestConnection = roomService.connect(code, guest, guestSocket);
    cleanupRooms.push(() => hostConnection.message(JSON.stringify({ type: "dissolve" })));
    hostConnection.message(JSON.stringify({ type: "sit", seatIndex: 0 }));
    guestConnection.message(JSON.stringify({ type: "sit", seatIndex: 1 }));
    hostConnection.message(JSON.stringify({ type: "start" }));

    const connections = new Map([
      [host.id, hostConnection],
      [guest.id, guestConnection]
    ]);
    const observedPhases = new Set<string>();

    for (let actionCount = 0; actionCount < 12; actionCount += 1) {
      for (const user of [host, guest]) {
        const view = roomService.view(code, user.id);
        expect(view.game).not.toBeNull();
        expect(view.game).not.toHaveProperty("deck");
        observedPhases.add(view.game!.phase);

        const socketView = latestRoomMessage(user.id === host.id ? hostSocket : guestSocket);
        expect(socketView?.game).not.toBeNull();
        expect(socketView?.game).not.toHaveProperty("deck");
      }

      const game = roomService.view(code, host.id).game!;
      if (game.phase === "complete") break;
      const actor = game.seats[game.actorIndex];
      const connection = actor.userId ? connections.get(actor.userId) : undefined;
      expect(connection).toBeDefined();
      const action = game.currentBet > actor.bet ? "call" : "check";
      connection!.message(JSON.stringify({ type: "action", action }));
    }

    expect(observedPhases).toEqual(new Set(["preflop", "flop", "turn", "river", "complete"]));
    for (const socket of [hostSocket, guestSocket]) {
      for (const message of socket.messages) {
        if (message.type === "room" && message.room.game) {
          expect(message.room.game).not.toHaveProperty("deck");
        }
      }
    }
  });
});
