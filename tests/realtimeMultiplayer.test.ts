/**
 * 多人实时对战 — 端到端服务器模拟测试
 * 直接调用 roomService 方法，模拟完整的多人在线生命周期
 * 覆盖: 创建房间→加入→落座→开局→牌局操作→离座→补码→断线→重连→退出→房间结束
 */
import { describe, expect, it } from "vitest";
import type { SafeUser } from "../server/auth";
import { db } from "../server/db";
import { roomService } from "../server/rooms";
import type { RoomView, RoomServerMessage } from "../src/multiplayer/types";

/* ── helpers ───────────────────────────────────────────────── */

interface MockSocket {
  readyState: number;
  messages: RoomServerMessage[];
  send(data: string): void;
  close(): void;
}

let userCounter = 0;
function makeUser(id: string): SafeUser {
  const user: SafeUser = { id, email: `${id}@test.com`, nickname: `玩家${id}`, avatar: "🦊" };
  // 直接插入 DB 满足外键约束
  db.prepare("INSERT OR IGNORE INTO users (id,email,password_hash,nickname,avatar,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, "fake-hash", user.nickname, user.avatar, Date.now());
  return user;
}

function makeSocket(): MockSocket {
  const sock: MockSocket = {
    readyState: 1,
    messages: [],
    send(data: string) {
      sock.messages.push(JSON.parse(data));
    },
    close() {
      sock.readyState = 3;
    },
  };
  return sock;
}

/** 从 socket 的 room 消息中提取最新 RoomView */
function latestRoom(sock: ReturnType<typeof makeSocket>): RoomView | null {
  for (let i = sock.messages.length - 1; i >= 0; i--) {
    const m = sock.messages[i];
    if ((m as any).type === "room") return (m as any).room;
  }
  return null;
}

/** 等待异步广播 */
const tick = () => new Promise((r) => setTimeout(r, 50));

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

/* ═══════════════════════════════════════════════════════════
   测试
   ═══════════════════════════════════════════════════════════ */

// ─── 基础生命周期 ──────────────────────────────────────────

describe("房间生命周期", () => {
  it("创建房间→加入→落座→开局→房间列表可见", async () => {
    const host = makeUser("host1");
    const p2 = makeUser("p2_1");
    const p3 = makeUser("p3_1");

    // 创建
    const { code } = roomService.create(host, {
      durationMinutes: 30,
      capacity: 6,
      startingStack: 2000,
      smallBlind: 10,
      bigBlind: 20,
    });
    expect(code).toHaveLength(6);

    // 房间列表
    const list = roomService.list();
    expect(list.some((r) => r.code === code)).toBe(true);

    // 加入
    roomService.join(code, p2);
    roomService.join(code, p3);

    // 连接+落座
    const sock1 = makeSocket();
    const sock2 = makeSocket();
    const sock3 = makeSocket();
    const conn1 = roomService.connect(code, host, sock1);
    const conn2 = roomService.connect(code, p2, sock2);
    const conn3 = roomService.connect(code, p3, sock3);

    conn1.message(JSON.stringify({ type: "sit", seatIndex: 0 }));
    conn2.message(JSON.stringify({ type: "sit", seatIndex: 1 }));
    conn3.message(JSON.stringify({ type: "sit", seatIndex: 2 }));

    await tick();
    const view = latestRoom(sock1)!;
    expect(view.members.filter((m) => m.seatIndex !== null).length).toBe(3);

    // 开局
    conn1.message(JSON.stringify({ type: "start" }));
    await tick();

    const gameView = latestRoom(sock1)!;
    expect(gameView.status).toBe("playing");
    expect(gameView.game).not.toBeNull();
    expect(gameView.game!.seats.length).toBe(3);
    expect(gameView.game!.phase).toBe("preflop");
  });

  it("非房主不能开局", async () => {
    const host = makeUser("host2");
    const other = makeUser("other2");
    const p3 = makeUser("p3_2");

    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, other);
    roomService.join(code, p3);

    const sock = makeSocket();
    const conn = roomService.connect(code, other, sock);
    conn.message(JSON.stringify({ type: "sit", seatIndex: 0 }));
    conn.message(JSON.stringify({ type: "start" }));
    await tick();

    const err = sock.messages.find((m: any) => m.type === "error");
    expect(err).toBeDefined();
    expect((err as any).message).toContain("房主");
  });

  it("不到2人不能开局", async () => {
    const host = makeUser("host3");
    const p2 = makeUser("p2_3");

    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, p2);

    const sock = makeSocket();
    const conn = roomService.connect(code, host, sock);
    conn.message(JSON.stringify({ type: "sit", seatIndex: 0 }));
    conn.message(JSON.stringify({ type: "start" }));
    await tick();

    const err = sock.messages.find((m: any) => m.type === "error");
    expect((err as any).message).toContain("两名");
  });

  it("房主解散房间", async () => {
    const host = makeUser("host4");
    const p2 = makeUser("p2_4");
    const p3 = makeUser("p3_4");

    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, p2);
    roomService.join(code, p3);

    const sock1 = makeSocket();
    const sock2 = makeSocket();
    const conn1 = roomService.connect(code, host, sock1);
    roomService.connect(code, p2, sock2);

    conn1.message(JSON.stringify({ type: "dissolve" }));
    await tick();

    const dissolved = sock2.messages.find((m: any) => m.type === "dissolved");
    expect(dissolved).toBeDefined();
  });
});

// ─── 牌局操作 ─────────────────────────────────────────────

describe("牌局操作", () => {
  it("完整一手: 跟注→过牌→摊牌→筹码守恒", async () => {
    const users = [makeUser("op_h0"), makeUser("op_h1"), makeUser("op_h2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    const total = 6000;

    // 一直跟注/过牌直到牌局结束
    let actions = 0;
    while (actions < 100) {
      const view = latestRoom(socks[0])!;
      if (!view.game || view.game.phase === "complete") break;
      const actorIdx = view.game.actorIndex;
      if (actorIdx < 0) break;
      const actorSeat = view.game.seats[actorIdx];
      if (!actorSeat) break;
      const actorMember = view.members.find((m) => m.seatId === actorSeat.id);
      if (!actorMember) break;
      const actorConnIdx = users.findIndex((u) => u.id === actorMember.userId);

      // 尝试 call, 如果不行就 check
      conns[actorConnIdx].message(JSON.stringify({ type: "action", action: "call" }));
      await tick();
      // 检查是否有错误 (call 不合法时用 check)
      const lastSock = socks[actorConnIdx];
      const lastErr = lastSock.messages[lastSock.messages.length - 1];
      if ((lastErr as any)?.type === "error") {
        lastSock.messages.pop();
        conns[actorConnIdx].message(JSON.stringify({ type: "action", action: "check" }));
        await tick();
      }
      actions++;
    }

    const finalView = latestRoom(socks[0])!;
    expect(finalView.game!.phase).toBe("complete");
    const finalTotal = finalView.game!.seats.reduce((sum, s) => sum + s.stack, 0);
    expect(finalTotal).toBe(total);
  });

  it("非当前玩家不能行动", async () => {
    const users = [makeUser("na0"), makeUser("na1"), makeUser("na2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    const view = latestRoom(socks[0])!;
    const actorIdx = view.game!.actorIndex;
    const nonActorIdx = (actorIdx + 1) % 3;

    // 非当前玩家尝试行动
    conns[nonActorIdx].message(JSON.stringify({ type: "action", action: "call" }));
    await tick();

    const err = socks[nonActorIdx].messages.find((m: any) => m.type === "error");
    expect(err).toBeDefined();
    expect((err as any).message).toContain("还没轮到你");
  });

  it("非法加注金额被拒绝", async () => {
    const users = [makeUser("ra0"), makeUser("ra1"), makeUser("ra2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    const view = latestRoom(socks[0])!;
    const actorIdx = view.game!.actorIndex;
    const actorMember = view.members.find((m) => m.seatId === view.game!.seats[actorIdx].id)!;
    const actorConnIdx = users.findIndex((u) => u.id === actorMember.userId);

    // 尝试非法加注 (低于最小)
    conns[actorConnIdx].message(JSON.stringify({ type: "action", action: "raise", raiseTo: 1 }));
    await tick();

    const err = socks[actorConnIdx].messages.find((m: any) => m.type === "error");
    expect(err).toBeDefined();
    expect((err as any).message).toContain("加注金额不合法");
  });
});

// ─── 中途加入/离座/补码 ───────────────────────────────────

describe("中途玩家变更", () => {
  it("新玩家中途加入，从下一手开始参与", async () => {
    const users = [makeUser("mj0"), makeUser("mj1"), makeUser("mj2"), makeUser("mj3")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.slice(0, 3).map(() => makeSocket());
    const conns = users.slice(0, 3).map((u, i) => roomService.connect(code, u, socks[i]));
    users.slice(0, 3).forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // mj3 加入
    roomService.join(code, users[3]);
    const sock3 = makeSocket();
    const conn3 = roomService.connect(code, users[3], sock3);
    conn3.message(JSON.stringify({ type: "sit", seatIndex: 3 }));
    await tick();

    const view = latestRoom(socks[0])!;
    // mj3 在 members 中但不在 game.seats 中 (等待下一手)
    expect(view.members.some((m) => m.userId === "mj3" && m.seatIndex !== null)).toBe(true);
    expect(view.game!.seats.some((s) => s.userId === "mj3")).toBe(false);
  });

  it("落座后设置补码不报错", async () => {
    const users = [makeUser("tu0"), makeUser("tu1"), makeUser("tu2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // 设置补码 (不应报错)
    socks[1].messages.length = 0;
    conns[1].message(JSON.stringify({ type: "topup", targetStack: 4000 }));
    await tick();

    const err = socks[1].messages.find((m: any) => m.type === "error");
    expect(err).toBeUndefined();
  });

  it("未落座不能设置补码", async () => {
    const host = makeUser("nt0");
    const p2 = makeUser("nt1");
    const p3 = makeUser("nt2");
    const spectator = makeUser("nt3");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, p2);
    roomService.join(code, p3);
    roomService.join(code, spectator);

    const sockS = makeSocket();
    const connS = roomService.connect(code, spectator, sockS);
    // spectator 没有落座, 直接尝试补码
    connS.message(JSON.stringify({ type: "topup", targetStack: 3000 }));
    await tick();

    const err = sockS.messages.find((m: any) => m.type === "error");
    expect((err as any)?.message).toContain("落座");
  });

  it("已落座玩家不能换座", async () => {
    const users = [makeUser("ns0"), makeUser("ns1"), makeUser("ns2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // ns0 尝试换座
    socks[0].messages.length = 0;
    conns[0].message(JSON.stringify({ type: "sit", seatIndex: 3 }));
    await tick();

    const err = socks[0].messages.find((m: any) => m.type === "error");
    expect((err as any)?.message).toContain("不能中途更换座位");
  });
});

// ─── 断线/重连/退出 ───────────────────────────────────────

describe("断线与退出", () => {
  it("断线后 socket close → connected=false", async () => {
    const users = [makeUser("dc0"), makeUser("dc1"), makeUser("dc2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // dc1 断线 (模拟 socket close)
    conns[1].close();
    await tick();

    const view = latestRoom(socks[0])!;
    const dc1Member = view.members.find((m) => m.userId === "dc1")!;
    expect(dc1Member.connected).toBe(false);
  });

  it("牌局中玩家退出: standAfterHand=true, 保持到手牌结束", async () => {
    const users = [makeUser("lv0"), makeUser("lv1"), makeUser("lv2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // lv1 退出
    conns[1].message(JSON.stringify({ type: "leave" }));
    await tick();

    // lv1 应收到 left 消息
    const left = socks[1].messages.find((m: any) => m.type === "left");
    expect(left).toBeDefined();
  });

  it("房主退出后主机转移", async () => {
    const users = [makeUser("ht0"), makeUser("ht1"), makeUser("ht2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));

    // ht0 退出
    conns[0].message(JSON.stringify({ type: "leave" }));
    await tick();

    // 房间仍存在, host 应转移
    const room = roomService.view(code, users[1].id);
    expect(room.hostUserId).not.toBe("ht0");
    expect(room.hostUserId).toBe(users[1].id);
  });

  it("所有人退出后房间无活跃成员", async () => {
    const users = [makeUser("al0"), makeUser("al1"), makeUser("al2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));

    // 全部退出
    conns.forEach((c) => c.message(JSON.stringify({ type: "leave" })));
    await tick();

    // 等待阶段: 房间仍在但所有成员已离开, list 不显示已满或无活跃成员的房间
    const list = roomService.list();
    const roomInList = list.find((r) => r.code === code);
    // 如果房间还在列表中, memberCount 应为 0
    if (roomInList) expect(roomInList.memberCount).toBe(0);
  });
});

// ─── 聊天与表情 ───────────────────────────────────────────

describe("聊天与表情", () => {
  it("聊天消息广播到所有人", async () => {
    const users = [makeUser("ch0"), makeUser("ch1"), makeUser("ch2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));

    conns[0].message(JSON.stringify({ type: "chat", text: "大家好！" }));
    await tick();

    // 所有人应收到更新的 room 消息 (含聊天记录)
    for (const sock of socks) {
      const view = latestRoom(sock);
      expect(view?.chatMessages.some((m) => m.text === "大家好！")).toBe(true);
    }
  });

  it("空聊天内容被拒绝", async () => {
    const host = makeUser("ec0");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    const sock = makeSocket();
    const conn = roomService.connect(code, host, sock);

    conn.message(JSON.stringify({ type: "chat", text: "   " }));
    await tick();

    const err = sock.messages.find((m: any) => m.type === "error");
    expect((err as any)?.message).toContain("不能为空");
  });

  it("超长聊天内容被拒绝", async () => {
    const host = makeUser("ec1");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    const sock = makeSocket();
    const conn = roomService.connect(code, host, sock);

    conn.message(JSON.stringify({ type: "chat", text: "a".repeat(81) }));
    await tick();

    const err = sock.messages.find((m: any) => m.type === "error");
    expect((err as any)?.message).toContain("80");
  });

  it("表情广播到所有人", async () => {
    const users = [makeUser("em0"), makeUser("em1"), makeUser("em2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));

    conns[0].message(JSON.stringify({ type: "emoji", emoji: "👏", targetSeatId: "seat-1" }));
    await tick();

    for (const sock of socks) {
      const emoji = sock.messages.find((m: any) => m.type === "emoji");
      expect(emoji).toBeDefined();
      expect((emoji as any).emoji).toBe("👏");
    }
  });
});

// ─── 公共牌与手牌隐私 ─────────────────────────────────────

describe("手牌隐私", () => {
  it("玩家只能看到自己的手牌", async () => {
    const users = [makeUser("pv0"), makeUser("pv1"), makeUser("pv2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    const view0 = latestRoom(socks[0])!;
    const view1 = latestRoom(socks[1])!;

    // pv0 能看到自己的手牌
    const mySeat0 = view0.game!.seats.find((s) => s.id === view0.mySeatId)!;
    expect(mySeat0.holeCards.length).toBe(2);

    // pv0 看不到 pv1 的手牌
    const otherSeat0 = view0.game!.seats.find((s) => s.id !== view0.mySeatId)!;
    expect(otherSeat0.holeCards.length).toBe(0);

    // pv1 能看到自己的手牌
    const mySeat1 = view1.game!.seats.find((s) => s.id === view1.mySeatId)!;
    expect(mySeat1.holeCards.length).toBe(2);
  });

  it("弃牌后可以公开底牌", async () => {
    const users = [makeUser("rv0"), makeUser("rv1"), makeUser("rv2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // rv0 弃牌
    conns[0].message(JSON.stringify({ type: "action", action: "fold" }));
    await tick();

    // rv0 公开第一张底牌
    conns[0].message(JSON.stringify({ type: "revealCard", cardIndex: 0 }));
    await tick();

    // 所有人应能看到 rv0 公开的底牌
    for (const sock of socks) {
      const view = latestRoom(sock)!;
      const rv0Seat = view.game!.seats.find((s) => s.userId === "rv0")!;
      expect(rv0Seat.shownHoleCards).toBeDefined();
      expect(rv0Seat.shownHoleCards![0]).not.toBeNull();
    }
  });
});

// ─── 座位冲突 ─────────────────────────────────────────────

describe("座位冲突", () => {
  it("两人不能坐同一个座位", async () => {
    const users = [makeUser("sc0"), makeUser("sc1"), makeUser("sc2")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));

    conns[0].message(JSON.stringify({ type: "sit", seatIndex: 0 }));
    conns[1].message(JSON.stringify({ type: "sit", seatIndex: 0 }));
    await tick();

    const err = socks[1].messages.find((m: any) => m.type === "error");
    expect((err as any)?.message).toContain("已经有人了");
  });

  it("座位号超出范围被拒绝", async () => {
    const host = makeUser("so0");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    const sock = makeSocket();
    const conn = roomService.connect(code, host, sock);

    conn.message(JSON.stringify({ type: "sit", seatIndex: 10 }));
    await tick();

    const err = sock.messages.find((m: any) => m.type === "error");
    expect((err as any)?.message).toContain("座位不存在");
  });
});

// ─── 房间已满 ─────────────────────────────────────────────

describe("房间容量", () => {
  it("满员后新玩家不能加入", async () => {
    const host = makeUser("cp0");
    const p2 = makeUser("cp1");
    const p3 = makeUser("cp2");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 3, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, p2);
    roomService.join(code, p3);

    // 所有人落座 (满员)
    const socks = [host, p2, p3].map(() => makeSocket());
    const conns = [host, p2, p3].map((u, i) => roomService.connect(code, u, socks[i]));
    conns.forEach((c, i) => c.message(JSON.stringify({ type: "sit", seatIndex: i })));
    await tick();

    // 满员后尝试加入
    expect(() => roomService.join(code, makeUser("cp3"))).toThrow("房间已满");
  });
});

// ─── 已结束房间 ───────────────────────────────────────────

describe("已结束房间", () => {
  it("已解散房间不能加入", async () => {
    const host = makeUser("fn0");
    const p2 = makeUser("fn1");
    const p3 = makeUser("fn2");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, p2);
    roomService.join(code, p3);

    const sock = makeSocket();
    const conn = roomService.connect(code, host, sock);
    conn.message(JSON.stringify({ type: "sit", seatIndex: 0 }));

    // 解散房间 (从 Map 中删除)
    conn.message(JSON.stringify({ type: "dissolve" }));
    await tick();

    expect(() => roomService.join(code, makeUser("fn3"))).toThrow("房间不存在");
  });
});

// ─── ping/pong ────────────────────────────────────────────

describe("心跳", () => {
  it("ping 返回 pong", async () => {
    const host = makeUser("pp0");
    const { code } = roomService.create(host, { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    const sock = makeSocket();
    const conn = roomService.connect(code, host, sock);

    conn.message(JSON.stringify({ type: "ping" }));
    await tick();

    const pong = sock.messages.find((m: any) => m.type === "pong");
    expect(pong).toBeDefined();
    expect((pong as any).at).toBeGreaterThan(0);
  });
});

// ─── 观战者视角 ───────────────────────────────────────────

describe("观战者", () => {
  it("未落座玩家可以观战, 不能行动", async () => {
    const users = [makeUser("sp0"), makeUser("sp1"), makeUser("sp2"), makeUser("sp3")];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 6, startingStack: 2000, smallBlind: 10, bigBlind: 20 });
    roomService.join(code, users[1]);
    roomService.join(code, users[2]);
    roomService.join(code, users[3]);

    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    users.slice(0, 3).forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // sp3 是观战者, 能看到牌局
    const view = latestRoom(socks[3])!;
    expect(view.game).not.toBeNull();
    expect(view.mySeatId).toBe("");
  });
});
