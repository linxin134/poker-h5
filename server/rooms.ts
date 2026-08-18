import { randomBytes, randomUUID } from "node:crypto";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import { evaluateHand } from "../src/game/cards";
import type { PokerState } from "../src/game/types";
import type {
  RoomClientMessage,
  RoomChatMessage,
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
  chatMessages: RoomChatMessage[];
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
    left: false,
    isHost: user.id === hostUserId,
    buyIn: 0,
    topUpTarget: null,
    standAfterHand: false,
    standingNow: false,
    savedStack: null
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
  const reveal = game.phase === "showdown" || (game.phase === "complete" && game.result?.reason === "showdown");
  for (const seat of game.seats) {
    seat.connected = room.members.find((member) => member.seatId === seat.id)?.connected ?? false;
    const ownCards = seat.userId === userId;
    const publicIndexes = new Set(seat.revealedHoleCardIndexes ?? []);
    seat.holeCardCount = seat.holeCards.length;
    seat.shownHoleCards = seat.holeCards.map((card, index) => ownCards || (reveal && !seat.folded) || publicIndexes.has(index) ? card : null);
    if (!ownCards && (!reveal || seat.folded)) {
      seat.holeCards = [];
    }
  }
  return game;
}

function scoreboard(room: RoomRuntime) {
  const activeSeats = new Map(room.game?.seats.flatMap((seat) => seat.userId ? [[seat.userId, seat]] : []) ?? []);
  const participantUserIds = new Set<string>([
    ...activeSeats.keys(),
    ...room.hands.flatMap((hand) => hand.seats.flatMap((seat) => seat.userId ? [seat.userId] : []))
  ]);
  return room.members.filter((member) => participantUserIds.has(member.userId)).map((member) => {
    const stack = activeSeats.get(member.userId)?.stack ?? member.savedStack ?? room.startingStack;
    return {
      seatId: member.seatId,
      nickname: member.nickname,
      avatar: member.avatar,
      stack,
      delta: stack - (member.buyIn || room.startingStack),
      connected: member.connected
    };
  }).sort((a, b) => b.delta - a.delta || b.stack - a.stack || a.nickname.localeCompare(b.nickname, "zh-CN"));
}

function viewFor(room: RoomRuntime, userId: string): RoomView {
  const member = room.members.find((entry) => entry.userId === userId && !entry.left);
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
    members: room.members.filter((entry) => !entry.left).map((entry) => ({ ...entry })),
    game: publicGame(room, userId),
    hands: [...room.hands].reverse(),
    scoreboard: scoreboard(room),
    chatMessages: room.chatMessages.map((message) => ({ ...message }))
  };
}

function send(socket: RoomSocket, message: RoomServerMessage) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcastRoom(room: RoomRuntime) {
  for (const member of room.members.filter((entry) => !entry.left)) {
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
  room.turnTimer = undefined;
  room.nextHandTimer = undefined;
  saveRoom(room);
  broadcastRoom(room);
  setTimeout(() => rooms.delete(room.code), 60_000);
}

function recordCompletedHand(room: RoomRuntime) {
  const game = room.game!;
  if (room.hands.some((hand) => hand.id === game.handId)) return;
  const winners = new Set(game.result?.winnerSeatIds ?? []);
  const reachedShowdown = game.result?.reason === "showdown";
  const hand: RoomHandRecord = {
    id: game.handId,
    handNumber: game.handNumber,
    board: [...game.board],
    pot: game.result?.pot ?? 0,
    winnerText: game.winnerText ?? "本手结束",
    seats: game.seats.map((seat) => ({
      userId: seat.userId,
      seatId: seat.id,
      nickname: seat.name,
      avatar: seat.avatar,
      cards: seat.holeCards.map((card, index) => reachedShowdown && !seat.folded || seat.revealedHoleCardIndexes?.includes(index) ? card : null),
      handName: reachedShowdown && !seat.folded && seat.holeCards.length + game.board.length >= 5 ? evaluateHand([...seat.holeCards, ...game.board]).name : undefined,
      showedDown: reachedShowdown && !seat.folded,
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
  const actor = room.game.seats[room.game.actorIndex];
  if (!actor) return;
  const actorUserId = actor.userId;
  const actorConnected = room.members.find((member) => member.userId === actorUserId)?.connected ?? false;
  const turnDuration = actorConnected ? 25_000 : 1_800;
  room.turnEndsAt = Date.now() + turnDuration;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = undefined;
    if (!room.game || room.game.phase === "complete") return;
    const currentActor = room.game.seats[room.game.actorIndex];
    if (!currentActor || currentActor.userId !== actorUserId) return;
    const legal = legalActions(room.game);
    const fallback = legal.actions.includes("check") ? "check" : "fold";
    room.game = applyAction(room.game, currentActor.id, fallback);
    if (room.game.phase === "complete") completeHand(room);
    else {
      scheduleTurn(room);
      broadcastRoom(room);
    }
  }, turnDuration + 50);
}

function ensureRoomProgress(room: RoomRuntime) {
  if (room.status !== "playing" || !room.game) return;
  if (room.game.phase === "complete") {
    if (!room.nextHandTimer && room.nextHandAt) {
      const remaining = Math.max(0, room.nextHandAt - Date.now());
      room.nextHandTimer = setTimeout(() => dealNextHand(room), remaining);
    }
    return;
  }
  const actor = room.game.seats[room.game.actorIndex];
  const actorConnected = room.members.find((member) => member.userId === actor?.userId)?.connected ?? false;
  const remaining = (room.turnEndsAt ?? 0) - Date.now();
  if (!room.turnTimer || remaining <= 0 || (!actorConnected && remaining > 2_000)) scheduleTurn(room);
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
    room.game.seats.at(-1)!.stack = member.savedStack ?? room.startingStack;
    member.savedStack = null;
  }

  if (pendingMembers.length > 0) {
    room.game.seats.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    room.game.dealerIndex = dealerSeatId ? room.game.seats.findIndex((seat) => seat.id === dealerSeatId) : -1;
  }
}

function applyPendingStands(room: RoomRuntime) {
  if (!room.game) return;
  const standingUserIds = new Set(room.members.filter((member) => member.standAfterHand).map((member) => member.userId));
  if (!standingUserIds.size) return;
  for (const member of room.members) {
    if (!standingUserIds.has(member.userId)) continue;
    const seat = room.game.seats.find((entry) => entry.userId === member.userId);
    member.savedStack = seat?.stack ?? member.savedStack;
    member.seatIndex = null;
    member.seatId = "";
    member.standAfterHand = false;
    member.standingNow = false;
    member.topUpTarget = null;
  }
  const dealerSeatId = room.game.seats[room.game.dealerIndex]?.id;
  room.game.seats = room.game.seats.filter((seat) => !standingUserIds.has(seat.userId ?? ""));
  if (room.game.seats.length === 0) {
    room.game.dealerIndex = -1;
  } else {
    const dealerNewIndex = room.game.seats.findIndex((seat) => seat.id === dealerSeatId);
    room.game.dealerIndex = dealerNewIndex >= 0 ? dealerNewIndex : Math.min(room.game.dealerIndex, room.game.seats.length - 1);
    if (room.game.dealerIndex < 0) room.game.dealerIndex = 0;
  }
}

function applyPendingTopUps(room: RoomRuntime) {
  if (!room.game) return;
  for (const member of room.members) {
    if (!member.topUpTarget) continue;
    const seat = room.game.seats.find((entry) => entry.id === member.seatId);
    if (!seat) continue;
    const added = Math.max(0, member.topUpTarget - seat.stack);
    seat.stack += added;
    member.buyIn += added;
    member.topUpTarget = null;
  }
}

function dealNextHand(room: RoomRuntime) {
  room.nextHandTimer = undefined;
  if (!room.game) return;
  const expired = room.endsAt !== null && Date.now() >= room.endsAt;
  for (const member of room.members) {
    if (member.seatIndex !== null && (!member.connected || member.left)) member.standAfterHand = true;
  }
  applyPendingStands(room);
  syncPendingSeats(room);
  applyPendingTopUps(room);
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
  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  room.turnTimer = undefined;
  room.nextHandTimer = undefined;
  room.turnEndsAt = null;
  recordCompletedHand(room);
  room.nextHandAt = Date.now() + 4_800;
  saveRoom(room);
  broadcastRoom(room);
  room.nextHandTimer = setTimeout(() => dealNextHand(room), 4_800);
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
  updateProfile(user: SafeUser) {
    for (const room of rooms.values()) {
      const member = room.members.find((entry) => entry.userId === user.id);
      if (!member) continue;
      member.nickname = user.nickname;
      member.avatar = user.avatar;
      const seat = room.game?.seats.find((entry) => entry.userId === user.id);
      if (seat) {
        seat.name = user.nickname;
        seat.avatar = user.avatar;
      }
      broadcastRoom(room);
    }
  },

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
      chatMessages: [],
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
    const existing = room.members.find((member) => member.userId === user.id);
    if (existing) {
      const stillInCurrentHand = room.game?.seats.some((seat) => seat.userId === user.id) ?? false;
      existing.left = false;
      existing.connected = false;
      if (!stillInCurrentHand) {
        existing.seatIndex = null;
        existing.seatId = "";
      }
      existing.standAfterHand = stillInCurrentHand;
      existing.standingNow = false;
      existing.isHost = existing.userId === room.hostUserId;
      saveRoom(room);
      broadcastRoom(room);
      return { code };
    }
    if (room.status === "finished") throw Object.assign(new Error("房间已经结束"), { statusCode: 409 });
    if (room.members.filter((member) => !member.left && member.seatIndex !== null).length >= room.capacity) throw Object.assign(new Error("房间已满"), { statusCode: 409 });
    if (!room.members.some((member) => !member.left)) room.hostUserId = user.id;
    room.members.push(memberFor(user, room.hostUserId));
    for (const member of room.members) member.isHost = !member.left && member.userId === room.hostUserId;
    saveRoom(room);
    broadcastRoom(room);
    return { code };
  },

  list(): RoomListItem[] {
    return [...rooms.values()]
      .filter((room) => room.status !== "finished" && room.members.filter((member) => !member.left && member.seatIndex !== null).length < room.capacity)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        code: room.code,
        hostNickname: room.members.find((member) => !member.left && member.userId === room.hostUserId)?.nickname ?? room.members.find((member) => !member.left)?.nickname ?? "房主",
        hostAvatar: room.members.find((member) => !member.left && member.userId === room.hostUserId)?.avatar ?? room.members.find((member) => !member.left)?.avatar ?? "♠",
        status: room.status,
        handNumber: room.game?.handNumber ?? 0,
        durationMinutes: room.durationMinutes,
        capacity: room.capacity,
        memberCount: room.members.filter((member) => !member.left && member.seatIndex !== null).length,
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
    const member = room.members.find((entry) => entry.userId === user.id && !entry.left);
    if (!member) throw new Error("请先加入房间");
    const sockets = room.clients.get(user.id) ?? new Set<RoomSocket>();
    sockets.add(socket);
    room.clients.set(user.id, sockets);
    member.connected = true;
    ensureRoomProgress(room);
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
          if (message.type === "dissolve") {
            if (room.hostUserId !== user.id) throw new Error("只有房主可以解散房间");
            room.status = "finished";
            if (room.turnTimer) clearTimeout(room.turnTimer);
            if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
            saveRoom(room);
            rooms.delete(room.code);
            const payload: RoomServerMessage = { type: "dissolved", message: "房间已由房主解散" };
            for (const sockets of room.clients.values()) for (const target of sockets) send(target, payload);
            return;
          }
          if (message.type === "leave") {
            const currentSeat = room.game?.seats.find((seat) => seat.userId === user.id);
            member.connected = false;
            member.left = true;
            member.topUpTarget = null;
            if (room.status === "playing" && currentSeat) {
              member.standAfterHand = true;
              member.standingNow = currentSeat.folded;
              member.seatIndex = null;
            } else {
              member.savedStack = currentSeat?.stack ?? member.savedStack;
              if (room.game) room.game.seats = room.game.seats.filter((seat) => seat.userId !== user.id);
              member.seatIndex = null;
              member.seatId = "";
              member.standAfterHand = false;
              member.standingNow = false;
            }
            const activeMembers = room.members.filter((entry) => !entry.left);
            if (room.hostUserId === user.id && activeMembers.length > 0) room.hostUserId = activeMembers[0].userId;
            for (const entry of room.members) entry.isHost = !entry.left && entry.userId === room.hostUserId;
            const activeHands = new Set(room.hands.flatMap((hand) => hand.seats.flatMap((seat) => seat.userId ? [seat.userId] : [])));
            room.members = room.members.filter((entry) => !entry.left || activeHands.has(entry.userId) || room.game?.seats.some((seat) => seat.userId === entry.userId));
            const userSockets = room.clients.get(user.id) ?? new Set<RoomSocket>();
            for (const target of userSockets) send(target, { type: "left" });
            room.clients.delete(user.id);
            if (activeMembers.length === 0 && room.status === "playing") {
              if (room.turnTimer) clearTimeout(room.turnTimer);
              if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
              room.turnTimer = undefined;
              room.nextHandTimer = undefined;
              room.status = "finished";
              rooms.delete(room.code);
              saveRoom(room);
              return;
            }
            ensureRoomProgress(room);
            saveRoom(room);
            broadcastRoom(room);
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
            member.standAfterHand = false;
            member.standingNow = false;
            if (member.buyIn === 0) member.buyIn = room.startingStack;
            saveRoom(room);
            broadcastRoom(room);
            return;
          }
          if (message.type === "stand") {
            if (member.seatIndex === null) throw new Error("你当前正在旁观");
            const currentSeat = room.game?.seats.find((seat) => seat.userId === user.id);
            const inCurrentHand = room.status === "playing" && room.game?.phase !== "complete" && Boolean(currentSeat);
            if (inCurrentHand) {
              if (currentSeat!.folded) {
                member.standAfterHand = true;
                member.standingNow = true;
                currentSeat!.standing = true;
              } else {
                member.standAfterHand = !member.standAfterHand;
              }
            } else {
              const seat = room.game?.seats.find((entry) => entry.userId === user.id);
              member.savedStack = seat?.stack ?? member.savedStack;
              if (room.game) room.game.seats = room.game.seats.filter((entry) => entry.userId !== user.id);
              member.seatIndex = null;
              member.seatId = "";
              member.standAfterHand = false;
              member.standingNow = false;
              member.topUpTarget = null;
            }
            saveRoom(room);
            broadcastRoom(room);
            return;
          }
          if (message.type === "topup") {
            if (member.seatIndex === null) throw new Error("请先落座再设置补码");
            const min = room.startingStack;
            const max = room.startingStack * 3;
            if (!Number.isFinite(message.targetStack) || message.targetStack < min || message.targetStack > max) throw new Error("补码数量超出范围");
            member.topUpTarget = Math.round(message.targetStack / room.bigBlind) * room.bigBlind;
            return;
          }
          if (message.type === "emoji") {
            const from = room.members.find((entry) => entry.userId === user.id)!;
            const payload: RoomServerMessage = { type: "emoji", id: randomUUID(), emoji: message.emoji.slice(0, 8), fromSeatId: from.seatId, targetSeatId: message.targetSeatId };
            for (const sockets of room.clients.values()) for (const target of sockets) send(target, payload);
            return;
          }
          if (message.type === "chat") {
            if (typeof message.text !== "string") throw new Error("聊天内容格式错误");
            const text = message.text.trim();
            if (!text) throw new Error("聊天内容不能为空");
            if (text.length > 80) throw new Error("聊天内容不能超过 80 个字符");
            room.chatMessages.push({
              id: randomUUID(),
              userId: member.userId,
              seatId: member.seatId,
              nickname: member.nickname,
              avatar: member.avatar,
              text,
              createdAt: Date.now()
            });
            if (room.chatMessages.length > 100) room.chatMessages.splice(0, room.chatMessages.length - 100);
            broadcastRoom(room);
            return;
          }
          if (message.type === "revealCard") {
            if (!room.game || room.status !== "playing") throw new Error("牌局尚未开始");
            const seat = room.game.seats.find((entry) => entry.userId === user.id);
            if (!seat || !seat.folded) throw new Error("只有弃牌后才能公开底牌");
            if (!Number.isInteger(message.cardIndex) || message.cardIndex < 0 || message.cardIndex >= seat.holeCards.length) throw new Error("底牌不存在");
            const revealed = new Set(seat.revealedHoleCardIndexes ?? []);
            revealed.add(message.cardIndex);
            seat.revealedHoleCardIndexes = [...revealed].sort();
            if (room.game.phase === "complete") {
              const recordedHand = room.hands.find((hand) => hand.id === room.game?.handId);
              const recordedSeat = recordedHand?.seats.find((entry) => entry.seatId === seat.id);
              if (recordedSeat) recordedSeat.cards[message.cardIndex] = seat.holeCards[message.cardIndex];
            }
            saveRoom(room);
            broadcastRoom(room);
            return;
          }
          if (message.type === "action") {
            if (!room.game || room.status !== "playing") throw new Error("牌局尚未开始");
            const actor = room.game.seats[room.game.actorIndex];
            if (!actor || actor.userId !== user.id) throw new Error("还没轮到你");
            // Validate raiseTo for raise actions
            if (message.action === "raise") {
              const legal = legalActions(room.game);
              if (!Number.isInteger(message.raiseTo) || message.raiseTo! < legal.minRaiseTo || message.raiseTo! > legal.maxRaiseTo) {
                throw new Error("加注金额不合法");
              }
            }
            room.game = applyAction(room.game, actor.id, message.action, message.raiseTo);
            if (message.action === "fold" && member.standAfterHand) {
              const foldedSeat = room.game.seats.find((seat) => seat.userId === user.id);
              if (foldedSeat) foldedSeat.standing = true;
              member.standingNow = true;
            }
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
          if (member.left) return;
          ensureRoomProgress(room);
          broadcastRoom(room);
        }
      }
    };
  }
};
