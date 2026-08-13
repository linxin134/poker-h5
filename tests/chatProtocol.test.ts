import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../server/db";
import { roomService } from "../server/rooms";
import type { SafeUser } from "../server/auth";
import type { RoomServerMessage } from "../src/multiplayer/types";

class TestSocket {
  readyState = 1;
  messages: RoomServerMessage[] = [];
  send(data: string) { this.messages.push(JSON.parse(data) as RoomServerMessage); }
}

function makeUser(label: string): SafeUser {
  const id = randomUUID();
  const user = { id, email: `${id}@chat.test`, nickname: label, avatar: label };
  db.prepare("INSERT INTO users (id,email,password_hash,nickname,avatar,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, "test-only", user.nickname, user.avatar, Date.now());
  return user;
}

describe("table chat protocol", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    cleanup.splice(0).forEach((run) => run());
    db.prepare("DELETE FROM users WHERE email LIKE ?").run("%@chat.test");
  });

  it("persists history and broadcasts a transient event with an authoritative seat id", () => {
    const host = makeUser("host");
    const guest = makeUser("guest");
    const { code } = roomService.create(host, { durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 });
    roomService.join(code, guest);
    const hostSocket = new TestSocket();
    const guestSocket = new TestSocket();
    const hostConnection = roomService.connect(code, host, hostSocket);
    const guestConnection = roomService.connect(code, guest, guestSocket);
    cleanup.push(() => hostConnection.message(JSON.stringify({ type:"dissolve" })));
    hostConnection.message(JSON.stringify({ type:"sit", seatIndex:0 }));
    guestConnection.message(JSON.stringify({ type:"sit", seatIndex:1 }));
    const seatId = roomService.view(code, guest.id).mySeatId;

    guestConnection.message(JSON.stringify({ type:"chat", text:"  这手打得漂亮  " }));

    const senderEvent = [...guestSocket.messages].reverse().find((message) => message.type === "chat");
    const observerEvent = [...hostSocket.messages].reverse().find((message) => message.type === "chat");
    expect(senderEvent).toEqual(observerEvent);
    expect(senderEvent).toMatchObject({ type:"chat", text:"这手打得漂亮", userId:guest.id, seatId });
    expect(roomService.view(code, host.id).chatMessages.at(-1)).toMatchObject({
      id: senderEvent?.type === "chat" ? senderEvent.id : "",
      text:"这手打得漂亮",
      userId:guest.id,
      seatId
    });
  });

  it("persists a spectator chat message but emits an empty seat id", () => {
    const host = makeUser("host");
    const spectator = makeUser("spectator");
    const { code } = roomService.create(host, { durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 });
    roomService.join(code, spectator);
    const hostSocket = new TestSocket();
    const spectatorSocket = new TestSocket();
    const hostConnection = roomService.connect(code, host, hostSocket);
    const spectatorConnection = roomService.connect(code, spectator, spectatorSocket);
    cleanup.push(() => hostConnection.message(JSON.stringify({ type:"dissolve" })));
    spectatorConnection.message(JSON.stringify({ type:"chat", text:"旁观留言" }));

    const event = [...hostSocket.messages].reverse().find((message) => message.type === "chat");
    expect(event).toMatchObject({ type:"chat", text:"旁观留言", userId:spectator.id, seatId:"" });
    expect(roomService.view(code, host.id).chatMessages.at(-1)).toMatchObject({ text:"旁观留言", seatId:"" });
  });
});
