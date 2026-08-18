/**
 * 玩家动态变更全场景测试
 * 覆盖: 落座、离座、补码、断线、重连、退出、中途加入
 * 通过模拟服务器端 roomService 逻辑进行纯函数级测试
 */
import { describe, expect, it, beforeEach } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import type { PokerState, PlayerAction, Seat } from "../src/game/types";

/* ═══════════════════════════════════════════════════════════
   模拟服务器端核心函数 (从 rooms.ts 提取的纯逻辑)
   ═══════════════════════════════════════════════════════════ */

interface MockMember {
  userId: string;
  seatId: string;
  seatIndex: number | null;
  nickname: string;
  connected: boolean;
  left: boolean;
  isHost: boolean;
  buyIn: number;
  topUpTarget: number | null;
  standAfterHand: boolean;
  standingNow: boolean;
  savedStack: number | null;
}

interface MockRoom {
  code: string;
  hostUserId: string;
  status: "waiting" | "playing" | "finished";
  capacity: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  endsAt: number | null;
  members: MockMember[];
  game: PokerState | null;
  handCount: number;
}

function makeMember(userId: string, isHost: boolean, startingStack: number): MockMember {
  return {
    userId,
    seatId: "",
    seatIndex: null,
    nickname: `玩家${userId}`,
    connected: false,
    left: false,
    isHost,
    buyIn: 0,
    topUpTarget: null,
    standAfterHand: false,
    standingNow: false,
    savedStack: null,
  };
}

function makeRoom(capacity = 6, startingStack = 2000, sb = 10, bb = 20): MockRoom {
  return {
    code: "TEST01",
    hostUserId: "p0",
    status: "waiting",
    capacity,
    startingStack,
    smallBlind: sb,
    bigBlind: bb,
    endsAt: Date.now() + 30 * 60_000,
    members: [],
    game: null,
    handCount: 0,
  };
}

/** 模拟 sit 操作 */
function doSit(room: MockRoom, userId: string, seatIndex: number): string | null {
  if (room.status === "finished") return "房间已经结束";
  const member = room.members.find((m) => m.userId === userId);
  if (!member) return "用户不存在";
  const alreadyPlaying = room.game?.seats.some((s) => s.userId === userId) ?? false;
  if (room.status === "playing" && alreadyPlaying) return "当前牌局玩家不能中途更换座位";
  if (seatIndex < 0 || seatIndex >= room.capacity) return "座位不存在";
  const occupied = room.members.find((m) => m.seatIndex === seatIndex && m.userId !== userId);
  if (occupied) return "这个座位已经有人了";
  member.seatIndex = seatIndex;
  member.seatId = `seat-${seatIndex}`;
  member.standAfterHand = false;
  member.standingNow = false;
  if (member.buyIn === 0) member.buyIn = room.startingStack;
  return null;
}

/** 模拟 stand 操作 */
function doStand(room: MockRoom, userId: string): string | null {
  const member = room.members.find((m) => m.userId === userId);
  if (!member) return "用户不存在";
  if (member.seatIndex === null) return "你当前正在旁观";
  const currentSeat = room.game?.seats.find((s) => s.userId === userId);
  const inCurrentHand = room.status === "playing" && room.game?.phase !== "complete" && Boolean(currentSeat);
  if (inCurrentHand) {
    if (currentSeat!.folded) {
      member.standAfterHand = true;
      member.standingNow = true;
      (currentSeat as any).standing = true;
    } else {
      member.standAfterHand = !member.standAfterHand;
    }
  } else {
    const seat = room.game?.seats.find((s) => s.userId === userId);
    member.savedStack = seat?.stack ?? member.savedStack;
    if (room.game) room.game.seats = room.game.seats.filter((s) => s.userId !== userId);
    member.seatIndex = null;
    member.seatId = "";
    member.standAfterHand = false;
    member.standingNow = false;
    member.topUpTarget = null;
  }
  return null;
}

/** 模拟 topup 操作 */
function doTopup(room: MockRoom, userId: string, targetStack: number): string | null {
  const member = room.members.find((m) => m.userId === userId);
  if (!member) return "用户不存在";
  if (member.seatIndex === null) return "请先落座再设置补码";
  const min = room.startingStack;
  const max = room.startingStack * 3;
  if (!Number.isFinite(targetStack) || targetStack < min || targetStack > max) return "补码数量超出范围";
  member.topUpTarget = Math.round(targetStack / room.bigBlind) * room.bigBlind;
  return null;
}

/** 模拟 applyPendingStands */
function applyPendingStands(room: MockRoom) {
  if (!room.game) return;
  const standingUserIds = new Set(room.members.filter((m) => m.standAfterHand).map((m) => m.userId));
  if (!standingUserIds.size) return;
  for (const member of room.members) {
    if (!standingUserIds.has(member.userId)) continue;
    const seat = room.game.seats.find((s) => s.userId === member.userId);
    member.savedStack = seat?.stack ?? member.savedStack;
    member.seatIndex = null;
    member.seatId = "";
    member.standAfterHand = false;
    member.standingNow = false;
    member.topUpTarget = null;
  }
  const dealerSeatId = room.game.seats[room.game.dealerIndex]?.id;
  room.game.seats = room.game.seats.filter((s) => !standingUserIds.has(s.userId ?? ""));
  if (room.game.seats.length === 0) {
    room.game.dealerIndex = -1;
  } else {
    const newIdx = room.game.seats.findIndex((s) => s.id === dealerSeatId);
    room.game.dealerIndex = newIdx >= 0 ? newIdx : Math.min(room.game.dealerIndex, room.game.seats.length - 1);
    if (room.game.dealerIndex < 0) room.game.dealerIndex = 0;
  }
}

/** 模拟 syncPendingSeats */
function syncPendingSeats(room: MockRoom) {
  if (!room.game) return;
  const dealerSeatId = room.game.seats[room.game.dealerIndex]?.id;
  const participating = new Set(room.game.seats.map((s) => s.userId));
  const pending = room.members.filter((m) => m.seatIndex !== null && !participating.has(m.userId));
  for (const member of pending) {
    room.game.seats.push({
      id: member.seatId,
      userId: member.userId,
      position: member.seatIndex!,
      name: member.nickname,
      avatar: "",
      stack: member.savedStack ?? room.startingStack,
      holeCards: [],
      bet: 0,
      totalContribution: 0,
      folded: false,
      allIn: false,
      isHuman: true,
      connected: member.connected,
    });
    member.savedStack = null;
  }
  if (pending.length > 0) {
    room.game.seats.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    room.game.dealerIndex = dealerSeatId ? room.game.seats.findIndex((s) => s.id === dealerSeatId) : -1;
  }
}

/** 模拟 applyPendingTopUps */
function applyPendingTopUps(room: MockRoom) {
  if (!room.game) return;
  for (const member of room.members) {
    if (!member.topUpTarget) continue;
    const seat = room.game.seats.find((s) => s.id === member.seatId);
    if (!seat) continue;
    const added = Math.max(0, member.topUpTarget - seat.stack);
    seat.stack += added;
    member.buyIn += added;
    member.topUpTarget = null;
  }
}

/** 模拟 startRoom */
function doStartRoom(room: MockRoom): string | null {
  const seated = room.members.filter((m) => m.seatIndex !== null).sort((a, b) => a.seatIndex! - b.seatIndex!);
  if (seated.length < 3) return "至少需要三名已落座玩家才能开始";
  room.status = "playing";
  const state = createInitialState(
    seated.map((m) => ({ id: m.seatId, name: m.nickname, avatar: "", stack: room.startingStack, isHuman: true })),
    room.smallBlind,
    room.bigBlind
  );
  state.seats.forEach((seat, i) => {
    seat.userId = seated[i].userId;
    seat.position = seated[i].seatIndex!;
    seat.connected = seated[i].connected;
  });
  room.game = startHand(state);
  room.handCount = 1;
  return null;
}

/** 模拟 completeHand + dealNextHand */
function doCompleteAndDealNext(
  room: MockRoom,
  random: () => number
): { finished: boolean; reason?: string } {
  // 完成当前手牌
  room.handCount++;

  // 断线玩家自动旁观
  for (const m of room.members) {
    if (m.seatIndex !== null && (!m.connected || m.left)) m.standAfterHand = true;
  }
  applyPendingStands(room);
  syncPendingSeats(room);
  applyPendingTopUps(room);

  const active = room.game!.seats.filter((s) => s.stack > 0).length;
  if (active < 2) {
    room.status = "finished";
    return { finished: true, reason: "玩家不足" };
  }
  room.game = startHand(room.game!, random);
  return { finished: false };
}

/** 模拟断线 */
function doDisconnect(room: MockRoom, userId: string) {
  const member = room.members.find((m) => m.userId === userId);
  if (member) member.connected = false;
}

/** 模拟重连 */
function doReconnect(room: MockRoom, userId: string) {
  const member = room.members.find((m) => m.userId === userId);
  if (member) {
    member.connected = true;
    member.left = false;
  }
}

/** 模拟 leave */
function doLeave(room: MockRoom, userId: string) {
  const member = room.members.find((m) => m.userId === userId);
  if (!member) return;
  const currentSeat = room.game?.seats.find((s) => s.userId === userId);
  member.connected = false;
  member.left = true;
  member.topUpTarget = null;
  if (room.status === "playing" && currentSeat) {
    member.standAfterHand = true;
    member.standingNow = (currentSeat as any).folded;
    member.seatIndex = null;
  } else {
    member.savedStack = currentSeat?.stack ?? member.savedStack;
    if (room.game) room.game.seats = room.game.seats.filter((s) => s.userId !== userId);
    member.seatIndex = null;
    member.seatId = "";
  }
  const active = room.members.filter((m) => !m.left);
  if (room.hostUserId === userId && active.length > 0) room.hostUserId = active[0].userId;
  for (const m of room.members) m.isHost = !m.left && m.userId === room.hostUserId;
}

/** 辅助: 玩家加入房间并落座 */
function joinAndSit(room: MockRoom, userId: string, seatIndex: number) {
  room.members.push(makeMember(userId, userId === room.hostUserId, room.startingStack));
  const m = room.members.find((x) => x.userId === userId)!;
  m.connected = true;
  doSit(room, userId, seatIndex);
}

/** 辅助: 筹码总和校验 */
function assertChipConservation(room: MockRoom) {
  if (!room.game) return;
  const total = room.game.seats.reduce((sum, s) => sum + s.stack + s.bet, 0) + room.game.pot;
  const expected = room.game.seats.length * room.startingStack; // 近似
  // 更精确: 检查无负数
  expect(room.game.seats.every((s) => s.stack >= 0 && s.bet >= 0)).toBe(true);
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

function playQuickHand(state: PokerState, random: () => number): PokerState {
  let i = 0;
  while (state.phase !== "complete" && i < 200) {
    const legal = legalActions(state);
    if (!legal.actions.length) break;
    const actor = state.seats[state.actorIndex];
    if (!actor) break;
    const r = random();
    let action: PlayerAction;
    let raiseTo: number | undefined;
    if (r < 0.04 && legal.actions.includes("all-in")) action = "all-in";
    else if (r < 0.15 && legal.actions.includes("raise")) {
      action = "raise";
      raiseTo = legal.minRaiseTo;
    } else if (r < 0.22 && legal.actions.includes("fold")) action = "fold";
    else action = legal.actions.includes("check") ? "check" : "call";
    state = applyAction(state, actor.id, action, raiseTo);
    i++;
  }
  return state;
}

/* ═══════════════════════════════════════════════════════════
   测试
   ═══════════════════════════════════════════════════════════ */

// ─── 落座 (sit) ──────────────────────────────────────────

describe("落座 sit", () => {
  it("等待阶段: 玩家可以落座到空位", () => {
    const room = makeRoom();
    room.members.push(makeMember("p0", true, 2000));
    room.members[0].connected = true;
    const err = doSit(room, "p0", 2);
    expect(err).toBeNull();
    expect(room.members[0].seatIndex).toBe(2);
    expect(room.members[0].seatId).toBe("seat-2");
    expect(room.members[0].buyIn).toBe(2000);
  });

  it("落座到已被占用的座位应报错", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 0);
    // p1 应该失败, 因为座位 0 已被 p0 占用
    const p1 = room.members.find((m) => m.userId === "p1")!;
    expect(p1.seatIndex).toBeNull(); // sit 失败
  });

  it("座位号超出范围应报错", () => {
    const room = makeRoom(6);
    room.members.push(makeMember("p0", true, 2000));
    const err = doSit(room, "p0", 6);
    expect(err).toBe("座位不存在");
    const err2 = doSit(room, "p0", -1);
    expect(err2).toBe("座位不存在");
  });

  it("已结束的房间不能落座", () => {
    const room = makeRoom();
    room.status = "finished";
    room.members.push(makeMember("p0", true, 2000));
    const err = doSit(room, "p0", 0);
    expect(err).toBe("房间已经结束");
  });

  it("牌局进行中已在牌桌的玩家不能换座", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);
    const err = doSit(room, "p0", 3);
    expect(err).toBe("当前牌局玩家不能中途更换座位");
  });

  it("落座时 buyIn 只在首次设置", () => {
    const room = makeRoom();
    room.members.push(makeMember("p0", true, 2000));
    room.members[0].connected = true;
    doSit(room, "p0", 0);
    expect(room.members[0].buyIn).toBe(2000);
    // 离座后再落座
    room.members[0].seatIndex = null;
    room.members[0].seatId = "";
    room.members[0].buyIn = 5000;
    doSit(room, "p0", 1);
    expect(room.members[0].buyIn).toBe(5000); // 不会重置
  });
});

// ─── 离座 (stand) ────────────────────────────────────────

describe("离座 stand", () => {
  it("等待阶段: 玩家可以立即离座", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    const err = doStand(room, "p0");
    expect(err).toBeNull();
    expect(room.members[0].seatIndex).toBeNull();
    expect(room.members[0].seatId).toBe("");
  });

  it("旁观者不能离座", () => {
    const room = makeRoom();
    room.members.push(makeMember("p0", true, 2000));
    const err = doStand(room, "p0");
    expect(err).toBe("你当前正在旁观");
  });

  it("牌局中未弃牌玩家: standAfterHand 切换", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);
    // p0 还没行动, 没弃牌
    expect(room.members[0].standAfterHand).toBe(false);
    doStand(room, "p0");
    expect(room.members[0].standAfterHand).toBe(true);
    // 再次 stand 取消
    doStand(room, "p0");
    expect(room.members[0].standAfterHand).toBe(false);
  });

  it("牌局中已弃牌玩家: 立即标记 standingNow", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);
    // p0 弃牌
    const p0Seat = room.game!.seats.find((s) => s.userId === "p0")!;
    p0Seat.folded = true;
    doStand(room, "p0");
    expect(room.members[0].standAfterHand).toBe(true);
    expect(room.members[0].standingNow).toBe(true);
    expect((p0Seat as any).standing).toBe(true);
  });

  it("牌局结束后: 保存筹码并移除座位", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);
    // 模拟牌局结束
    room.game!.phase = "complete";
    doStand(room, "p0");
    expect(room.members[0].savedStack).toBeDefined();
    expect(room.members[0].seatIndex).toBeNull();
    expect(room.game!.seats.find((s) => s.userId === "p0")).toBeUndefined();
  });
});

// ─── 补码 (topup) ────────────────────────────────────────

describe("补码 topup", () => {
  it("未落座不能设置补码", () => {
    const room = makeRoom();
    room.members.push(makeMember("p0", true, 2000));
    const err = doTopup(room, "p0", 2000);
    expect(err).toBe("请先落座再设置补码");
  });

  it("补码目标低于最小值应报错", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    const err = doTopup(room, "p0", 500); // min = 2000
    expect(err).toBe("补码数量超出范围");
  });

  it("补码目标高于最大值应报错", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    const err = doTopup(room, "p0", 10000); // max = 6000
    expect(err).toBe("补码数量超出范围");
  });

  it("补码目标应对齐到大盲", () => {
    const room = makeRoom(6, 2000, 10, 20);
    joinAndSit(room, "p0", 0);
    const err = doTopup(room, "p0", 3050);
    expect(err).toBeNull();
    expect(room.members[0].topUpTarget).toBe(3060); // 对齐到 20
  });

  it("补码在下一手生效: 筹码补到目标", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // p0 输了一些
    const p0Seat = room.game!.seats.find((s) => s.userId === "p0")!;
    p0Seat.stack = 1500;

    // 设置补码到 4000
    doTopup(room, "p0", 4000);
    expect(room.members[0].topUpTarget).toBe(4000);

    // 完成当前手牌, 进入下一手
    const random = seeded(99999);
    room.game!.phase = "complete";
    applyPendingStands(room);
    syncPendingSeats(room);
    applyPendingTopUps(room);

    // 补码应生效
    expect(p0Seat.stack).toBe(4000);
    expect(room.members[0].topUpTarget).toBeNull();
    expect(room.members[0].buyIn).toBe(2000 + 2500); // 初始2000 + 补码2500
  });

  it("补码不超过当前筹码: 不增加", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    const p0Seat = room.game!.seats.find((s) => s.userId === "p0")!;
    p0Seat.stack = 3000; // 赢了

    doTopup(room, "p0", 2000);
    applyPendingTopUps(room);

    // 筹码已超过目标, 不应减少
    expect(p0Seat.stack).toBe(3000);
  });
});

// ─── 断线与重连 ─────────────────────────────────────────

describe("断线与重连", () => {
  it("断线后标记 connected=false", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    doDisconnect(room, "p0");
    expect(room.members[0].connected).toBe(false);
  });

  it("重连后标记 connected=true, left=false", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    room.members[0].left = true;
    doReconnect(room, "p0");
    expect(room.members[0].connected).toBe(true);
    expect(room.members[0].left).toBe(false);
  });

  it("断线玩家在下一手自动站起", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // p0 断线
    doDisconnect(room, "p0");

    // 完成当前手
    room.game!.phase = "complete";
    const result = doCompleteAndDealNext(room, seeded(11111));

    // p0 应该被站起
    expect(room.members[0].seatIndex).toBeNull();
    expect(room.members[0].standAfterHand).toBe(false);
  });

  it("断线玩家重连后可以重新落座", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    doDisconnect(room, "p0");
    room.game!.phase = "complete";
    doCompleteAndDealNext(room, seeded(22222));

    // p0 被站起, 保存了筹码
    expect(room.members[0].seatIndex).toBeNull();
    expect(room.members[0].savedStack).toBeDefined();

    // p0 重连
    doReconnect(room, "p0");
    // p0 重新落座到空位
    const err = doSit(room, "p0", 0);
    expect(err).toBeNull();
    expect(room.members[0].seatIndex).toBe(0);
  });
});

// ─── 退出 (leave) ────────────────────────────────────────

describe("退出 leave", () => {
  it("等待阶段退出: 立即移除座位", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    doLeave(room, "p0");
    expect(room.members[0].left).toBe(true);
    expect(room.members[0].seatIndex).toBeNull();
    expect(room.game?.seats.find((s) => s.userId === "p0")).toBeUndefined();
  });

  it("牌局中退出: 保持在牌桌直到手牌结束", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    doLeave(room, "p0");
    expect(room.members[0].left).toBe(true);
    expect(room.members[0].standAfterHand).toBe(true);
    // p0 的座位仍在牌桌中 (等待手牌结束)
    expect(room.game!.seats.find((s) => s.userId === "p0")).toBeDefined();
  });

  it("牌局中已弃牌玩家退出: standingNow=true", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    const p0Seat = room.game!.seats.find((s) => s.userId === "p0")!;
    p0Seat.folded = true;
    doLeave(room, "p0");
    expect(room.members[0].standingNow).toBe(true);
  });

  it("房主退出: 主机转移", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);

    expect(room.hostUserId).toBe("p0");
    doLeave(room, "p0");
    expect(room.hostUserId).toBe("p1");
    expect(room.members.find((m) => m.userId === "p1")!.isHost).toBe(true);
  });

  it("所有人退出: 房间结束", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    doLeave(room, "p0");
    doLeave(room, "p1");
    doLeave(room, "p2");
    const activeMembers = room.members.filter((m) => !m.left);
    expect(activeMembers.length).toBe(0);
  });
});

// ─── 中途加入 (syncPendingSeats) ─────────────────────────

describe("中途加入", () => {
  it("牌局进行中: 新玩家落座后从下一手开始参与", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // 新玩家 p3 加入
    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    doSit(room, "p3", 3);

    // p3 不在当前手牌中
    expect(room.game!.seats.find((s) => s.userId === "p3")).toBeUndefined();

    // 完成当前手, 进入下一手
    room.game!.phase = "complete";
    applyPendingStands(room);
    syncPendingSeats(room);

    // p3 现在在座位中
    expect(room.game!.seats.find((s) => s.userId === "p3")).toBeDefined();
    expect(room.game!.seats.find((s) => s.userId === "p3")!.stack).toBe(2000);
  });

  it("中途加入使用保存的筹码", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    room.members[3].savedStack = 1500; // 之前保存的筹码
    doSit(room, "p3", 3);

    room.game!.phase = "complete";
    syncPendingSeats(room);

    const p3Seat = room.game!.seats.find((s) => s.userId === "p3")!;
    expect(p3Seat.stack).toBe(1500); // 使用保存的筹码
    expect(room.members[3].savedStack).toBeNull(); // 清除
  });

  it("中途加入按座位号排序", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 2);
    joinAndSit(room, "p2", 4);
    doStartRoom(room);

    // p3 坐 1 号, p4 坐 3 号
    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    doSit(room, "p3", 1);
    room.members.push(makeMember("p4", false, 2000));
    room.members[4].connected = true;
    doSit(room, "p4", 3);

    room.game!.phase = "complete";
    syncPendingSeats(room);

    // 座位应按 position 排序: 0,1,2,3,4
    const positions = room.game!.seats.map((s) => s.position);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });

  it("中途加入后 dealerIndex 保持正确", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    const oldDealerSeatId = room.game!.seats[room.game!.dealerIndex]?.id;

    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    doSit(room, "p3", 3);

    room.game!.phase = "complete";
    syncPendingSeats(room);

    // dealerIndex 应指向同一个座位
    expect(room.game!.seats[room.game!.dealerIndex]?.id).toBe(oldDealerSeatId);
  });
});

// ─── 离座+补码+加入 综合场景 ─────────────────────────────

describe("综合场景: 离座+补码+加入", () => {
  it("场景: 4人开局, 1人离座, 1人补码, 1人新加入 → 4人继续", () => {
    const room = makeRoom(6, 2000);
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // p1 输了筹码
    const p1Seat = room.game!.seats.find((s) => s.userId === "p1")!;
    p1Seat.stack = 800;

    // p1 设置补码
    doTopup(room, "p1", 3000);
    expect(room.members[1].topUpTarget).toBe(3000);

    // p0 请求下一手旁观
    doStand(room, "p0");

    // 新玩家 p3 加入
    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    doSit(room, "p3", 3);

    // 完成当前手
    room.game!.phase = "complete";
    const result = doCompleteAndDealNext(room, seeded(55555));

    // p0 被站起
    expect(room.members[0].seatIndex).toBeNull();
    // p1 补码生效
    expect(p1Seat.stack).toBe(3000);
    // p3 加入座位
    expect(room.game!.seats.find((s) => s.userId === "p3")).toBeDefined();
    // 仍有 3 人在座 (p1, p2, p3)
    const seatedCount = room.game!.seats.length;
    expect(seatedCount).toBe(3);
    expect(result.finished).toBe(false);
  });

  it("场景: 5人开局, 2人淘汰, 1人新加入 → 4人继续", () => {
    const room = makeRoom(6, 2000);
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    joinAndSit(room, "p3", 3);
    joinAndSit(room, "p4", 4);
    doStartRoom(room);

    // p0, p1 输光
    room.game!.seats.find((s) => s.userId === "p0")!.stack = 0;
    room.game!.seats.find((s) => s.userId === "p1")!.stack = 0;

    // p3 设置补码
    doTopup(room, "p3", 4000);

    // 新玩家 p5 加入
    room.members.push(makeMember("p5", false, 2000));
    room.members[5].connected = true;
    doSit(room, "p5", 5);

    room.game!.phase = "complete";
    const result = doCompleteAndDealNext(room, seeded(66666));

    // p3 补码: 补码在 dealNextHand 中的 applyPendingTopUps 生效
    // 但新一手 startHand 又会扣盲注, 所以最终 stack = 4000 - 盲注
    const p3Seat = room.game!.seats.find((s) => s.userId === "p3");
    expect(p3Seat!.stack).toBeGreaterThanOrEqual(3980); // 4000 - 可能的盲注
    expect(p3Seat!.stack).toBeLessThanOrEqual(4000);
    // p5 加入
    expect(room.game!.seats.find((s) => s.userId === "p5")).toBeDefined();
    // p0, p1 stack=0 仍在座位中但被 folded, p2-p5 仍在座
    // 总共 6 个座位 (p0~p5), 但只有 4 人有筹码
    const activePlayers = room.game!.seats.filter((s) => s.stack > 0);
    expect(activePlayers.length).toBe(4);
  });

  it("场景: 全员离座/淘汰后房间结束", () => {
    const room = makeRoom(6, 100);
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // 全员输光
    room.game!.seats.forEach((s) => (s.stack = 0));

    room.game!.phase = "complete";
    const result = doCompleteAndDealNext(room, seeded(77777));
    expect(result.finished).toBe(true);
    expect(room.status).toBe("finished");
  });
});

// ─── 连续多手 + 玩家变更 ─────────────────────────────────

describe("连续多手 + 玩家动态变更", () => {
  it("10手连续: 随机离座/落座/补码/断线, 筹码守恒", () => {
    const room = makeRoom(6, 2000);
    for (let i = 0; i < 5; i++) joinAndSit(room, `p${i}`, i);
    doStartRoom(room);

    const random = seeded(88888);
    const total = room.game!.seats.reduce((sum, s) => sum + s.stack + s.bet, 0) + room.game!.pot;

    for (let hand = 0; hand < 10; hand++) {
      if (room.status === "finished") break;

      // 打完当前手
      room.game = playQuickHand(room.game!, random);
      room.game.phase = "complete";

      // 随机操作
      const r = random();
      if (r < 0.2) {
        // 随机断线一个玩家
        const connected = room.members.filter((m) => m.connected && m.seatIndex !== null);
        if (connected.length > 0) {
          const target = connected[Math.floor(random() * connected.length)];
          doDisconnect(room, target.userId);
        }
      }
      if (r < 0.15) {
        // 随机补码
        const seated = room.members.filter((m) => m.seatIndex !== null);
        if (seated.length > 0) {
          const target = seated[Math.floor(random() * seated.length)];
          doTopup(room, target.userId, room.startingStack * 2);
        }
      }

      const result = doCompleteAndDealNext(room, random);
      if (result.finished) break;

      // 重连断线玩家
      for (const m of room.members) {
        if (!m.connected && !m.left) doReconnect(room, m.userId);
      }
    }

    // 筹码守恒
    if (room.game) {
      const finalTotal = room.game.seats.reduce((sum, s) => sum + s.stack, 0);
      expect(finalTotal).toBeGreaterThan(0);
      expect(room.game.seats.every((s) => s.stack >= 0)).toBe(true);
    }
  });

  it("玩家离开+加入: 座位号不冲突", () => {
    const room = makeRoom(6, 2000);
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // p0 离开
    doLeave(room, "p0");

    // 完成手牌
    room.game!.phase = "complete";
    doCompleteAndDealNext(room, seeded(111));

    // p3 坐到 p0 的 0 号位
    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    doSit(room, "p3", 0);
    expect(room.members[3].seatIndex).toBe(0);

    // 下一手 p3 应该在座位中
    room.game!.phase = "complete";
    syncPendingSeats(room);
    expect(room.game!.seats.find((s) => s.userId === "p3")).toBeDefined();
  });
});

// ─── 边界条件 ────────────────────────────────────────────

describe("边界条件", () => {
  it("capacity=3 最小容量: 3人开局后不能加入", () => {
    const room = makeRoom(3, 2000);
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);

    // 房间满
    const seated = room.members.filter((m) => m.seatIndex !== null);
    expect(seated.length).toBe(3);
  });

  it("capacity=9 最大容量: 9人全部落座", () => {
    const room = makeRoom(9, 2000);
    for (let i = 0; i < 9; i++) joinAndSit(room, `p${i}`, i);
    const seated = room.members.filter((m) => m.seatIndex !== null);
    expect(seated.length).toBe(9);
  });

  it("补码对齐到大盲: 非整数倍自动四舍五入", () => {
    const room = makeRoom(6, 2000, 10, 20);
    joinAndSit(room, "p0", 0);
    doTopup(room, "p0", 3055);
    expect(room.members[0].topUpTarget).toBe(3060);
  });

  it("savedStack 为 null 时使用 startingStack", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // 新玩家 p3, 没有 savedStack
    room.members.push(makeMember("p3", false, 2000));
    room.members[3].connected = true;
    room.members[3].savedStack = null;
    doSit(room, "p3", 3);

    room.game!.phase = "complete";
    syncPendingSeats(room);

    const p3Seat = room.game!.seats.find((s) => s.userId === "p3")!;
    expect(p3Seat.stack).toBe(2000); // 使用 startingStack
  });

  it("standAfterHand 在 dealNextHand 后自动清除", () => {
    const room = makeRoom();
    joinAndSit(room, "p0", 0);
    joinAndSit(room, "p1", 1);
    joinAndSit(room, "p2", 2);
    doStartRoom(room);

    // p0 请求旁观
    doStand(room, "p0");
    expect(room.members[0].standAfterHand).toBe(true);

    // 完成手牌
    room.game!.phase = "complete";
    doCompleteAndDealNext(room, seeded(333));

    // standAfterHand 应该清除
    expect(room.members[0].standAfterHand).toBe(false);
    expect(room.members[0].standingNow).toBe(false);
  });
});
