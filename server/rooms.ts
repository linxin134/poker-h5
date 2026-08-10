import { randomBytes } from "node:crypto";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import type { PokerState } from "../src/game/types";
import type {
  RoomClientMessage,
  RoomDurationMinutes,
  RoomHandRecord,
  RoomListItem,
  RoomMember,
  RoomServerMessage,
  RoomView
} from "../src/multiplayer/types";
import type { SafeUser } from "./auth";
import { db } from "./db";

interface RoomSocket {
  readyState: number;
  send(data: string): void;
}

interface RoomRuntime {
  code: string;
  hostUserId: string;
  status: "waiting" | "playing" | "finished";
  durationMinutes: RoomDurationMinutes;
  capacity: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  startedAt: number | null;
  endsAt: number | null;
  turnEndsAt: number | null;
  nextHandAt: number | null;
  createdAt: number;
  members: RoomMember[];
  game: PokerState | null;
  hands: RoomHandRecord[];
  clients: Map<string, Set<RoomSocket>>;
  turnTimer?: NodeJS.Timeout;
  nextHandTimer?: NodeJS.Timeout;
}

export interface CreateRoomOptions {
  durationMinutes: RoomDurationMinutes;
  capacity: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
}

const rooms = new Map<string, RoomRuntime>();

function makeCode() {
  for (;;) {
    const code = randomBytes(3).toString("hex").toUpperCase();
    if (!rooms.has(code)) return code;
  }
}

function memberFor(user: SafeUser, hostUserId: string): RoomMember {
  return {
    userId: user.id,
    seatId: "",
    seatIndex: null,
    nickname: user.nickname,
    avatar: user.avatar,
    connected: false,
    isHost: user.id === hostUserId
  };
}

function saveRoom(room: RoomRuntime) {
  db.prepare(`INSERT INTO rooms(code,host_user_id,status,duration_minutes,capacity,starting_stack,small_blind,big_blind,started_at,ends_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,ends_at=excluded.ends_at,updated_at=excluded.updated_at`)
    .run(room.code, room.hostUserId, room.status, room.durationMinutes, room.capacity, room.startingStack, room.smallBlind, room.bigBlind, room.startedAt, room.endsAt, Date.now());
}

function publicGame(room: RoomRuntime, userId: string) {
  if (!room.game) return null;
  const game = structuredClone(room.game);
  const reveal = game.phase === "complete" || game.phase === "showdown";
  for (const seat of game.seats) {
    seat.connected = room.members.find((member) => member.seatId === seat.id)?.connected ?? false;
    if (!reveal && seat.userId !== userId) {
      seat.holeCardCount = seat.holeCards.length;
      seat.holeCards = [];
    }
  }
  return game;
}

function scoreboard(room: RoomRuntime) {
  const stacks = new Map(room.game?.seats.map((seat) => [seat.id, seat.stack]) ?? []);
  return room.members.filter((member) => member.seatIndex !== null).map((member) => {
    const stack = stacks.get(member.seatId) ?? room.startingStack;
    return {
      seatId: member.seatId,
      nickname: member.nickname,
      avatar: member.avatar,
      stack,
      delta: stack - room.startingStack,
      connected: member.connected
    };
  }).sort((a, b) => b.stack - a.stack);
}

function viewFor(room: RoomRuntime, userId: string): RoomView {
  const member = room.members.find((entry) => entry.userId === userId);
  if (!member) throw Object.assign(new Error("你不在这个房间"), { statusCode: 403 });
  return {
    code: room.code,
    hostUserId: room.hostUserId,
    status: room.status,
    durationMinutes: room.durationMinutes,
    capacity: room.capacity,
    startingStack: room.startingStack,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    turnEndsAt: room.turnEndsAt,
    nextHandAt: room.nextHandAt,
    mySeatId: member.seatId,
    members: room.members.map((entry) => ({ ...entry })),
    game: publicGame(room, userId),
    hands: [...room.hands].reverse(),
    scoreboard: scoreboard(room)
  };
}

function send(socket: RoomSocket, message: RoomServerMessage) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcastRoom(room: RoomRuntime) {
  for (const member of room.members) {
    const message: RoomServerMessage = { type: "room", room: viewFor(room, member.userId) };
    for (const socket of room.clients.get(member.userId) ?? []) send(socket, message);
  }
}

function finishRoom(room: RoomRuntime) {
  room.status = "finished";
  room.turnEndsAt = null;
  room.nextHandAt = null;
  if (room.game?.room) room.game.room.status = "finished";
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  saveRoom(room);
  broadcastRoom(room);
}

function recordCompletedHand(room: RoomRuntime) {
  const game = room.game!;
  if (room.hands.some((hand) => hand.id === game.handId)) return;
  const winners = new Set(game.result?.winnerSeatIds ?? []);
  const hand: RoomHandRecord = {
    id: game.handId,
    handNumber: game.handNumber,
    board: [...game.board],
    pot: game.result?.pot ?? 0,
    winnerText: game.winnerText ?? "本手结束",
    seats: game.seats.map((seat) => ({
      seatId: seat.id,
      nickname: seat.name,
      avatar: seat.avatar,
      cards: [...seat.holeCards],
      delta: seat.stack - (game.handStartStacks?.[seat.id] ?? room.startingStack),
      finalStack: seat.stack,
      folded: seat.folded,
      won: winners.has(seat.id)
    })),
    completedAt: Date.now()
  };
  room.hands.push(hand);
  db.prepare("INSERT OR REPLACE INTO room_hands(room_code,hand_number,result_json,created_at) VALUES(?,?,?,?)")
    .run(room.code, hand.handNumber, JSON.stringify(hand), hand.completedAt);
  const updateStats = db.prepare("UPDATE stats SET hands=hands+1,wins=wins+?,profit=profit+?,biggest_pot=MAX(biggest_pot,?) WHERE user_id=?");
  for (const seat of hand.seats) {
    const member = room.members.find((entry) => entry.seatId === seat.seatId);
    if (member) updateStats.run(seat.won ? 1 : 0, seat.delta, hand.pot, member.userId);
  }
}

function scheduleTurn(room: RoomRuntime) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (!room.game || room.game.phase === "complete" || room.status !== "playing") {
    room.turnEndsAt = null;
    return;
  }
  room.turnEndsAt = Date.now() + 25_000;
  room.turnTimer = setTimeout(() => {
    if (!room.game || room.game.phase === "complete") return;
    const actor = room.game.seats[room.game.actorIndex];
    if (!actor) return;
    const legal = legalActions(room.game);
    const fallback = legal.actions.includes("check") ? "check" : "fold";
    room.game = applyAction(room.game, actor.id, fallback);
    if (room.game.phase === "complete") completeHand(room);
    else {
      scheduleTurn(room);
      broadcastRoom(room);
    }
  }, 25_050);
}

function syncPendingSeats(room: RoomRuntime) {
  if (!room.game) return;
  const dealerSeatId = room.game.seats[room.game.dealerIndex]?.id;
  const participatingUserIds = new Set(room.game.seats.map((seat) => seat.userId));
  const pendingMembers = room.members.filter((member) => member.seatIndex !== null && !participatingUserIds.has(member.userId));

  for (const member of pendingMembers) {
    room.game.seats.push({
      id: member.seatId,
      userId: member.userId,
      position: member.seatIndex!,
      name: member.nickname,
      avatar: member.avatar,
      stack: room.startingStack,
      holeCards: [],
      bet: 0,
      totalContribution: 0,
      folded: false,
      allIn: false,
      isHuman: true,
      connected: member.connected
    });
  }

  if (pendingMembers.length > 0) {
    room.game.seats.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    room.game.dealerIndex = dealerSeatId ? room.game.seats.findIndex((seat) => seat.id === dealerSeatId) : -1;
  }
}

function dealNextHand(room: RoomRuntime) {
  if (!room.game) return;
  const expired = room.endsAt !== null && Date.now() >= room.endsAt;
  syncPendingSeats(room);
  const activePlayers = room.game.seats.filter((seat) => seat.stack > 0).length;
  if (expired || activePlayers < 2) {
    finishRoom(room);
    return;
  }
  room.nextHandAt = null;
  room.game = startHand(room.game);
  scheduleTurn(room);
  saveRoom(room);
  broadcastRoom(room);
}

function completeHand(room: RoomRuntime) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnEndsAt = null;
  recordCompletedHand(room);
  room.nextHandAt = Date.now() + 3_500;
  saveRoom(room);
  broadcastRoom(room);
  room.nextHandTimer = setTimeout(() => dealNextHand(room), 3_500);
}

function startRoom(room: RoomRuntime) {
  const seatedMembers = room.members.filter((member) => member.seatIndex !== null).sort((a, b) => a.seatIndex! - b.seatIndex!);
  if (seatedMembers.length < 3) throw new Error("至少需要三名已落座玩家才能开始");
  const now = Date.now();
  room.status = "playing";
  room.startedAt = now;
  room.endsAt = now + room.durationMinutes * 60_000;
  const state = createInitialState(seatedMembers.map((member) => ({
    id: member.seatId,
    name: member.nickname,
    avatar: member.avatar,
    stack: room.startingStack,
    isHuman: true
  })), room.smallBlind, room.bigBlind);
  state.seats.forEach((seat, index) => {
    seat.userId = seatedMembers[index].userId;
    seat.position = seatedMembers[index].seatIndex!;
    seat.connected = seatedMembers[index].connected;
  });
  state.room = { id: room.code, durationMinutes: room.durationMinutes, startedAt: now, endsAt: room.endsAt, status: "active" };
  room.game = startHand(state);
  scheduleTurn(room);
  saveRoom(room);
  broadcastRoom(room);
}

export const roomService = {
  create(user: SafeUser, options: CreateRoomOptions) {
    const code = makeCode();
    const room: RoomRuntime = {
      code,
      hostUserId: user.id,
      status: "waiting",
      durationMinutes: options.durationMinutes,
      capacity: options.capacity,
      startingStack: options.startingStack,
      smallBlind: options.smallBlind,
      bigBlind: options.bigBlind,
      startedAt: null,
      endsAt: null,
      turnEndsAt: null,
      nextHandAt: null,
      createdAt: Date.now(),
      members: [memberFor(user, user.id)],
      game: null,
      hands: [],
      clients: new Map()
    };
    rooms.set(code, room);
    saveRoom(room);
    return { code };
  },

  join(codeInput: string, user: SafeUser) {
    const code = codeInput.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw Object.assign(new Error("房间不存在或服务器已重启"), { statusCode: 404 });
    if (room.members.some((member) => member.userId === user.id)) return { code };
    if (room.status === "finished") throw Object.assign(new Error("房间已经结束"), { statusCode: 409 });
    if (room.members.length >= room.capacity) throw Object.assign(new Error("房间已满"), { statusCode: 409 });
    room.members.push(memberFor(user, room.hostUserId));
    saveRoom(room);
    broadcastRoom(room);
    return { code };
  },

  list(): RoomListItem[] {
    return [...rooms.values()]
      .filter((room) => room.status !== "finished" && room.members.length < room.capacity)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        code: room.code,
        hostNickname: room.members[0]?.nickname ?? "房主",
        hostAvatar: room.members[0]?.avatar ?? "♠",
        status: room.status,
        handNumber: room.game?.handNumber ?? 0,
        durationMinutes: room.durationMinutes,
        capacity: room.capacity,
        memberCount: room.members.filter((member) => member.seatIndex !== null).length,
        startingStack: room.startingStack,
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
        createdAt: room.createdAt
      }));
  },

  view(codeInput: string, userId: string) {
    const room = rooms.get(codeInput.trim().toUpperCase());
    if (!room) throw Object.assign(new Error("房间不存在或服务器已重启"), { statusCode: 404 });
    return viewFor(room, userId);
  },

  connect(codeInput: string, user: SafeUser, socket: RoomSocket) {
    const code = codeInput.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error("房间不存在或服务器已重启");
    const member = room.members.find((entry) => entry.userId === user.id);
    if (!member) throw new Error("请先加入房间");
    const sockets = room.clients.get(user.id) ?? new Set<RoomSocket>();
    sockets.add(socket);
    room.clients.set(user.id, sockets);
    member.connected = true;
    broadcastRoom(room);

    return {
      message(raw: string) {
        let message: RoomClientMessage;
        try { message = JSON.parse(raw) as RoomClientMessage; }
        catch { send(socket, { type: "error", message: "消息格式错误" }); return; }
        try {
          if (message.type === "ping") { send(socket, { type: "pong", at: Date.now() }); return; }
          if (message.type === "start") {
            if (room.hostUserId !== user.id) throw new Error("只有房主可以开始");
            if (room.status !== "waiting") throw new Error("房间已经开始");
            startRoom(room);
            return;
          }
          if (message.type === "sit") {
            if (room.status === "finished") throw new Error("房间已经结束");
            const alreadyPlaying = room.game?.seats.some((seat) => seat.userId === user.id) ?? false;
            if (room.status === "playing" && alreadyPlaying) throw new Error("当前牌局玩家不能中途更换座位");
            if (!Number.isInteger(message.seatIndex) || message.seatIndex < 0 || message.seatIndex >= room.capacity) throw new Error("座位不存在");
            const occupied = room.members.find((entry) => entry.seatIndex === message.seatIndex && entry.userId !== user.id);
            if (occupied) throw new Error("这个座位已经有人了");
            member.seatIndex = message.seatIndex;
            member.seatId = `seat-${message.seatIndex}`;
            saveRoom(room);
            broadcastRoom(room);
            return;
          }
          if (message.type === "emoji") {
            const from = room.members.find((entry) => entry.userId === user.id)!;
            const payload: RoomServerMessage = { type: "emoji", id: crypto.randomUUID(), emoji: message.emoji.slice(0, 8), fromSeatId: from.seatId, targetSeatId: message.targetSeatId };
            for (const sockets of room.clients.values()) for (const target of sockets) send(target, payload);
            return;
          }
          if (message.type === "action") {
            if (!room.game || room.status !== "playing") throw new Error("牌局尚未开始");
            const actor = room.game.seats[room.game.actorIndex];
            if (!actor || actor.userId !== user.id) throw new Error("还没轮到你");
            room.game = applyAction(room.game, actor.id, message.action, message.raiseTo);
            if (room.game.phase === "complete") completeHand(room);
            else {
              scheduleTurn(room);
              broadcastRoom(room);
            }
          }
        } catch (error) {
          send(socket, { type: "error", message: error instanceof Error ? error.message : "操作失败" });
        }
      },
      close() {
        const current = room.clients.get(user.id);
        current?.delete(socket);
        if (!current?.size) {
          room.clients.delete(user.id);
          member.connected = false;
          broadcastRoom(room);
        }
      }
    };
  }
};
