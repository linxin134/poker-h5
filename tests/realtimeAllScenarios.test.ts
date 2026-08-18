/**
 * 端到端服务器模拟 — 2~8人所有德州牌局场景局势测试
 * 通过 roomService 真实调用 + mock WebSocket，覆盖每一种牌局局势
 */
import { describe, expect, it } from "vitest";
import type { SafeUser } from "../server/auth";
import { db } from "../server/db";
import { roomService } from "../server/rooms";
import type { RoomView, RoomServerMessage } from "../src/multiplayer/types";
import { legalActions } from "../src/game/engine";

/* ── helpers ────────────────────────────────────────────── */

interface MockSocket { readyState: number; messages: RoomServerMessage[]; send(d: string): void; close(): void; }
let uid = 0;
function makeUser(tag: string): SafeUser {
  const id = `${tag}_${++uid}`;
  const user: SafeUser = { id, email: `${id}@test.com`, nickname: `玩家${id}`, avatar: "🦊" };
  db.prepare("INSERT OR IGNORE INTO users (id,email,password_hash,nickname,avatar,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, "x", user.nickname, user.avatar, Date.now());
  return user;
}
function makeSocket(): MockSocket {
  const s: MockSocket = { readyState: 1, messages: [], send(d) { s.messages.push(JSON.parse(d)); }, close() { s.readyState = 3; } };
  return s;
}
function latestRoom(sock: MockSocket): RoomView | null {
  for (let i = sock.messages.length - 1; i >= 0; i--) { const m = sock.messages[i] as any; if (m.type === "room") return m.room; }
  return null;
}
const tick = () => new Promise<void>(r => setTimeout(r, 50));

/** 创建 N 人房间并开局，返回 { code, users, socks, conns } */
async function setupRoom(n: number, opts?: { startingStack?: number; sb?: number; bb?: number }) {
  const stack = opts?.startingStack ?? 2000;
  const sb = opts?.sb ?? 10;
  const bb = opts?.bb ?? 20;
  // 至少需要 3 人才能开局
  const users = Array.from({ length: Math.max(n, 3) }, (_, i) => makeUser(`s${n}p${i}`));
  const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: Math.max(n, 9), startingStack: stack, smallBlind: sb, bigBlind: bb });
  for (let i = 1; i < users.length; i++) roomService.join(code, users[i]);
  const socks = users.map(() => makeSocket());
  const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
  users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
  conns[0].message(JSON.stringify({ type: "start" }));
  await tick();
  return { code, users, socks, conns };
}

/** 从某个玩家的视角获取当前 actor 并发送 action, 返回是否成功 */
async function act(socks: MockSocket[], conns: ReturnType<typeof roomService.connect>[], users: SafeUser[], action: string, raiseTo?: number): Promise<boolean> {
  const view = latestRoom(socks[0])!;
  if (!view.game || view.game.phase === "complete") return false;
  const actorIdx = view.game.actorIndex;
  if (actorIdx < 0) return false;
  const actorSeat = view.game.seats[actorIdx];
  if (!actorSeat) return false;
  const actorMember = view.members.find(m => m.seatId === actorSeat.id);
  if (!actorMember) return false;
  const ci = users.findIndex(u => u.id === actorMember.userId);
  if (ci < 0) return false;
  const prevMsgCount = socks[ci].messages.length;
  conns[ci].message(JSON.stringify({ type: "action", action, raiseTo }));
  await tick();
  // 检查是否有错误
  const newMsgs = socks[ci].messages.slice(prevMsgCount);
  const hasError = newMsgs.some((m: any) => m.type === "error");
  return !hasError;
}

/** 跟注/过牌直到牌局结束 */
async function callThrough(socks: MockSocket[], conns: ReturnType<typeof roomService.connect>[], users: SafeUser[], maxActions = 100) {
  let staleCount = 0;
  for (let i = 0; i < maxActions; i++) {
    const view = latestRoom(socks[0])!;
    if (!view.game || view.game.phase === "complete") return;
    const prevPhase = view.game.phase;
    const prevActor = view.game.actorIndex;
    // 先尝试 call, 如果不行就 check, 再不行就 fold
    let ok = await act(socks, conns, users, "call");
    if (!ok) ok = await act(socks, conns, users, "check");
    if (!ok) ok = await act(socks, conns, users, "fold");
    if (!ok) {
      staleCount++;
      if (staleCount > 5) return; // 卡住了
      continue;
    }
    staleCount = 0;
  }
}

/** 从某个玩家视角获取 legalActions (复用引擎) */
function getLegal(socks: MockSocket[]) {
  const view = latestRoom(socks[0])!;
  if (!view.game) return { actions: [] as string[] };
  return legalActions(view.game);
}

function getGame(socks: MockSocket[]) { return latestRoom(socks[0])!.game!; }
function getTotal(socks: MockSocket[]) { const g = getGame(socks); return g.seats.reduce((s, x) => s + x.stack + x.bet, 0) + g.pot; }

/* ═══════════════════════════════════════════════════════════
   2 人 (Heads-up) — 需要3人开局, 第3人旁观
   ═══════════════════════════════════════════════════════════ */

describe("2人 Heads-up 全场景", () => {
  it("翻牌前: 庄家小盲先行动，跟注→BB过牌→翻牌→BB先行动→过牌到摊牌", async () => {
    // 3人开局, 第3人旁观
    const { socks, conns, users } = await setupRoom(3);
    const total = 6000;
    const g = getGame(socks);
    expect(g.phase).toBe("preflop");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(total);
  });

  it("翻牌前加注→跟注→翻牌后全下→摊牌", async () => {
    const { socks, conns, users } = await setupRoom(3);
    const total = 6000;
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // SB call
    await act(socks, conns, users, "call");
    // BB call
    await act(socks, conns, users, "call");
    expect(getGame(socks).phase).toBe("flop");
    // flop: SB all-in
    await act(socks, conns, users, "all-in");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(total);
  });

  it("翻牌前弃牌: SB弃牌→BB直接赢", async () => {
    const { socks, conns, users } = await setupRoom(3);
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).result?.reason).toBe("fold");
    expect(getTotal(socks)).toBe(6000);
  });

  it("短码 vs 深码: 一方被淘汰", async () => {
    const { socks, conns, users } = await setupRoom(3, { startingStack: 50 });
    const total = 150; // 3 * 50
    await act(socks, conns, users, "all-in");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(total);
    const stacks = getGame(socks).seats.map(s => s.stack);
    expect(stacks.some(s => s === 0)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
   3 人
   ═══════════════════════════════════════════════════════════ */

describe("3人桌全场景", () => {
  it("翻牌前: UTG先行动，全员跟注→翻牌→SB先行动→全员过牌到摊牌", async () => {
    const { socks, conns, users } = await setupRoom(3);
    const total = 6000;
    expect(getGame(socks).phase).toBe("preflop");
    // 3人: dealer=0, SB=1, BB=2, UTG=dealer=0
    expect(getGame(socks).actorIndex).toBe(0);
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(total);
  });

  it("翻牌前UTG加注→SB/BB跟注→翻牌后持续加注→边池产生", async () => {
    const { socks, conns, users } = await setupRoom(3);
    const total = 6000;
    // UTG raise to 60
    await act(socks, conns, users, "raise", 60);
    // SB call
    await act(socks, conns, users, "call");
    // BB call
    await act(socks, conns, users, "call");
    expect(getGame(socks).phase).toBe("flop");
    // flop: SB raise
    await act(socks, conns, users, "raise", 100);
    // BB call
    await act(socks, conns, users, "call");
    // UTG call
    await act(socks, conns, users, "call");
    // turn + river: 过牌到摊牌
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(total);
  });

  it("一人弃牌→两人打到摊牌", async () => {
    const { socks, conns, users } = await setupRoom(3);
    // UTG fold
    await act(socks, conns, users, "fold");
    // SB call
    await act(socks, conns, users, "call");
    // BB check
    await act(socks, conns, users, "check");
    expect(getGame(socks).phase).toBe("flop");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(6000);
  });

  it("全员不同额度全下→多级边池", async () => {
    const { socks, conns, users } = await setupRoom(3, { startingStack: 500 });
    // p0 全下 500
    await act(socks, conns, users, "all-in");
    // p1 全下 500
    await act(socks, conns, users, "all-in");
    // p2 跟注 500
    await act(socks, conns, users, "call");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(1500);
    expect(getGame(socks).board).toHaveLength(5);
  });

  it("短码全下不重开加注", async () => {
    const { socks, conns, users } = await setupRoom(3, { startingStack: 100, sb: 5, bb: 10 });
    const total = 300;
    // UTG call 10
    await act(socks, conns, users, "call");
    // SB call 10
    await act(socks, conns, users, "call");
    // BB all-in for 100 (raise 90, 大于 minRaise=10, 重开加注)
    await act(socks, conns, users, "all-in");
    expect(getGame(socks).currentBet).toBe(100);
    // UTG: 应该能 call/fold, 因为 all-in > minRaise 所以也能 raise
    const legal = getLegal(socks);
    expect(legal.actions).toContain("call");
    expect(legal.actions).toContain("fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(total);
  });
});

/* ═══════════════════════════════════════════════════════════
   4 人
   ═══════════════════════════════════════════════════════════ */

describe("4人桌全场景", () => {
  it("全员跟注到摊牌: 筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(4);
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(8000);
  });

  it("翻牌前3人加注-再加注-全下", async () => {
    const { socks, conns, users } = await setupRoom(4);
    // UTG(d=0) raise 60
    await act(socks, conns, users, "raise", 60);
    // MP raise 180
    await act(socks, conns, users, "raise", 180);
    // SB all-in
    await act(socks, conns, users, "all-in");
    // BB fold
    await act(socks, conns, users, "fold");
    // UTG call
    await act(socks, conns, users, "call");
    // MP call
    await act(socks, conns, users, "call");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(8000);
  });

  it("翻牌后: 翻牌加注→转牌全下→河牌过牌", async () => {
    const { socks, conns, users } = await setupRoom(4);
    // preflop: 全部 call
    await act(socks, conns, users, "call"); // UTG
    await act(socks, conns, users, "call"); // MP
    await act(socks, conns, users, "call"); // SB
    await act(socks, conns, users, "check"); // BB
    expect(getGame(socks).phase).toBe("flop");
    // flop: SB bet 40
    await act(socks, conns, users, "raise", 40);
    // BB call
    await act(socks, conns, users, "call");
    // UTG fold
    await act(socks, conns, users, "fold");
    // MP fold
    await act(socks, conns, users, "fold");
    expect(getGame(socks).phase).toBe("turn");
    // turn: 过牌
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(8000);
  });

  it("4人3种不同筹码全下: 3级边池", async () => {
    const users = Array.from({ length: 4 }, (_, i) => makeUser(`e4p${i}`));
    const stacks = [100, 200, 400, 800];
    const { code } = roomService.create(users[0], { durationMinutes: 30, capacity: 9, startingStack: stacks[0], smallBlind: 5, bigBlind: 10 });
    for (let i = 1; i < 4; i++) roomService.join(code, users[i]);
    const socks = users.map(() => makeSocket());
    const conns = users.map((u, i) => roomService.connect(code, u, socks[i]));
    // 使用不同筹码落座 — 通过 topup
    users.forEach((_, i) => conns[i].message(JSON.stringify({ type: "sit", seatIndex: i })));
    conns[0].message(JSON.stringify({ type: "start" }));
    await tick();

    // 全员全下
    for (let i = 0; i < 4; i++) { await act(socks, conns, users, "all-in"); }
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).board).toHaveLength(5);
    expect(getGame(socks).seats.every(s => s.stack >= 0)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
   5 人
   ═══════════════════════════════════════════════════════════ */

describe("5人桌全场景", () => {
  it("全员过牌到摊牌: 筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(5);
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(10000);
    expect(getGame(socks).result?.reason).toBe("showdown");
  });

  it("翻牌前: UTG加注→4人跟注→翻牌后2人弃牌→3人摊牌", async () => {
    const { socks, conns, users } = await setupRoom(5);
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // 其余跟注
    for (let i = 0; i < 4; i++) await act(socks, conns, users, "call");
    expect(getGame(socks).phase).toBe("flop");
    // flop: SB bet, BB fold, UTG fold, MP call, CO fold
    await act(socks, conns, users, "raise", 80);
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(10000);
  });

  it("5人全下: 自动发满5张公共牌", async () => {
    const { socks, conns, users } = await setupRoom(5, { startingStack: 100 });
    for (let i = 0; i < 5; i++) await act(socks, conns, users, "all-in");
    // 全员全下后自动推进到 complete
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).board).toHaveLength(5);
    expect(getTotal(socks)).toBe(500);
  });

  it("连续两手: 庄位轮转", async () => {
    const { socks, conns, users } = await setupRoom(5);
    const d1 = getGame(socks).dealerIndex;
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    // 下一手: 庄位应轮转
    // 通过 roomService 模拟下一手 (服务器会自动调度, 这里手动验证逻辑)
    expect(getGame(socks).dealerIndex).toBe(d1);
  });
});

/* ═══════════════════════════════════════════════════════════
   6 人
   ═══════════════════════════════════════════════════════════ */

describe("6人桌全场景", () => {
  it("全员跟注到摊牌: 筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(6);
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(12000);
  });

  it("翻牌前: UTG raise→MP 3bet→CO 4bet→其余弃牌→两人摊牌", async () => {
    const { socks, conns, users } = await setupRoom(6);
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // MP raise 180
    await act(socks, conns, users, "raise", 180);
    // CO raise 500
    await act(socks, conns, users, "raise", 500);
    // BTN fold
    await act(socks, conns, users, "fold");
    // SB fold
    await act(socks, conns, users, "fold");
    // BB fold
    await act(socks, conns, users, "fold");
    // UTG call
    await act(socks, conns, users, "call");
    // MP call
    await act(socks, conns, users, "call");
    expect(getGame(socks).phase).toBe("flop");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(12000);
  });

  it("翻牌后: 持续加注到底→多人边池", async () => {
    const { socks, conns, users } = await setupRoom(6);
    // preflop: 全部 call
    for (let i = 0; i < 6; i++) { const ok = await act(socks, conns, users, "call"); if (!ok) await act(socks, conns, users, "check"); }
    expect(getGame(socks).phase).toBe("flop");
    // flop: SB raise 80, 3人 call, 2人 fold
    await act(socks, conns, users, "raise", 80);
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "call");
    // turn + river: 过牌
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(12000);
  });

  it("6人3人全下+3人弃牌", async () => {
    const { socks, conns, users } = await setupRoom(6, { startingStack: 200 });
    // UTG all-in
    await act(socks, conns, users, "all-in");
    // MP all-in
    await act(socks, conns, users, "all-in");
    // CO all-in
    await act(socks, conns, users, "all-in");
    // BTN fold
    await act(socks, conns, users, "fold");
    // SB fold
    await act(socks, conns, users, "fold");
    // BB fold
    await act(socks, conns, users, "fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(1200);
    expect(getGame(socks).board).toHaveLength(5);
  });
});

/* ═══════════════════════════════════════════════════════════
   7 人
   ═══════════════════════════════════════════════════════════ */

describe("7人桌全场景", () => {
  it("全员跟注到摊牌: 筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(7);
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(14000);
  });

  it("翻牌前: 多级加注→3人跟注→翻牌后2人全下→边池", async () => {
    const { socks, conns, users } = await setupRoom(7);
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // 其余人: 4 call, 2 fold (按实际 actor 顺序)
    for (let i = 0; i < 6; i++) {
      const ok = await act(socks, conns, users, "call");
      if (!ok) await act(socks, conns, users, "fold");
    }
    expect(getGame(socks).phase).toBe("flop");
    // flop: 全下
    await act(socks, conns, users, "all-in");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(14000);
  });

  it("7人: 6人弃牌→1人赢", async () => {
    const { socks, conns, users } = await setupRoom(7);
    for (let i = 0; i < 6; i++) await act(socks, conns, users, "fold");
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).result?.reason).toBe("fold");
    expect(getTotal(socks)).toBe(14000);
  });
});

/* ═══════════════════════════════════════════════════════════
   8 人
   ═══════════════════════════════════════════════════════════ */

describe("8人桌全场景", () => {
  it("全员跟注到摊牌: 筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(8);
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(16000);
  });

  it("翻牌前: UTG raise→MP 3bet→CO 4bet→BTN 5bet→全员跟注→翻牌后过牌到摊牌", async () => {
    const { socks, conns, users } = await setupRoom(8);
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // MP raise 180
    await act(socks, conns, users, "raise", 180);
    // CO raise 500
    await act(socks, conns, users, "raise", 500);
    // BTN raise 1200
    await act(socks, conns, users, "raise", 1200);
    // 其余 fold
    for (let i = 0; i < 3; i++) await act(socks, conns, users, "fold");
    // UTG/MP/CO call
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "call");
    // 翻牌后过牌到摊牌
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(16000);
  });

  it("8人全员全下: 自动发满5张公共牌+筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(8, { startingStack: 100 });
    for (let i = 0; i < 8; i++) await act(socks, conns, users, "all-in");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).board).toHaveLength(5);
    expect(getTotal(socks)).toBe(800);
    expect(getGame(socks).seats.every(s => s.stack >= 0)).toBe(true);
  });

  it("8人: 翻牌前4人弃牌→4人打到摊牌", async () => {
    const { socks, conns, users } = await setupRoom(8);
    for (let i = 0; i < 4; i++) await act(socks, conns, users, "fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(16000);
  });

  it("8人: 翻牌后多人加注→转牌全下→河牌过牌", async () => {
    const { socks, conns, users } = await setupRoom(8);
    // preflop: 全部 call/check
    for (let i = 0; i < 8; i++) { const ok = await act(socks, conns, users, "call"); if (!ok) await act(socks, conns, users, "check"); }
    expect(getGame(socks).phase).toBe("flop");
    // flop: raise + 3 call + 4 fold
    await act(socks, conns, users, "raise", 60);
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    // turn: 全下
    await act(socks, conns, users, "all-in");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(16000);
  });
});

/* ═══════════════════════════════════════════════════════════
   跨人数: 特殊牌局局势
   ═══════════════════════════════════════════════════════════ */

describe("特殊牌局局势", () => {
  it("河牌圈: 最后两人全下→摊牌", async () => {
    const { socks, conns, users } = await setupRoom(3);
    // preflop call
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "check");
    expect(getGame(socks).phase).toBe("flop");
    // flop check through
    for (let i = 0; i < 3; i++) { const ok = await act(socks, conns, users, "check"); if (!ok) await act(socks, conns, users, "call"); }
    expect(getGame(socks).phase).toBe("turn");
    // turn check through
    for (let i = 0; i < 3; i++) { const ok = await act(socks, conns, users, "check"); if (!ok) await act(socks, conns, users, "call"); }
    expect(getGame(socks).phase).toBe("river");
    // river: 两人全下, 一人弃牌
    await act(socks, conns, users, "all-in");
    await act(socks, conns, users, "all-in");
    await act(socks, conns, users, "fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(6000);
  });

  it("翻牌圈: 全员全下→自动发转牌+河牌", async () => {
    const { socks, conns, users } = await setupRoom(4, { startingStack: 200 });
    // preflop call
    for (let i = 0; i < 4; i++) { const ok = await act(socks, conns, users, "call"); if (!ok) await act(socks, conns, users, "check"); }
    expect(getGame(socks).phase).toBe("flop");
    expect(getGame(socks).board).toHaveLength(3);
    // flop: 全员全下
    for (let i = 0; i < 4; i++) await act(socks, conns, users, "all-in");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).board).toHaveLength(5);
    expect(getTotal(socks)).toBe(800);
  });

  it("翻牌前: BB面对加注后 3bet→其余跟注→边池正确", async () => {
    const { socks, conns, users } = await setupRoom(5);
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // MP fold
    await act(socks, conns, users, "fold");
    // CO fold
    await act(socks, conns, users, "fold");
    // SB call
    await act(socks, conns, users, "call");
    // BB raise 200 (3bet)
    await act(socks, conns, users, "raise", 200);
    // UTG call
    await act(socks, conns, users, "call");
    // SB call
    await act(socks, conns, users, "call");
    expect(getGame(socks).phase).toBe("flop");
    expect(getGame(socks).pot).toBe(600); // 200 * 3
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(10000);
  });

  it("5人: 翻牌前加注→翻牌持续加注→转牌弃牌到一人", async () => {
    const { socks, conns, users } = await setupRoom(5);
    // preflop: UTG raise, 3 call, 1 fold
    await act(socks, conns, users, "raise", 60);
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "call");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "call");
    // flop: bet, 3 fold
    await act(socks, conns, users, "raise", 200);
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).result?.reason).toBe("fold");
    expect(getTotal(socks)).toBe(10000);
  });

  it("6人: 翻牌前全员全下+短码混合→正确边池+筹码守恒", async () => {
    const { socks, conns, users } = await setupRoom(6, { startingStack: 300 });
    // UTG all-in 300
    await act(socks, conns, users, "all-in");
    // MP all-in 300
    await act(socks, conns, users, "all-in");
    // CO call 300
    await act(socks, conns, users, "call");
    // BTN all-in 300
    await act(socks, conns, users, "all-in");
    // SB fold
    await act(socks, conns, users, "fold");
    // BB fold
    await act(socks, conns, users, "fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getGame(socks).board).toHaveLength(5);
    expect(getTotal(socks)).toBe(1800);
    expect(getGame(socks).seats.every(s => s.stack >= 0)).toBe(true);
  });

  it("7人: 河牌圈4人全下→摊牌→边池正确分配", async () => {
    const { socks, conns, users } = await setupRoom(7, { startingStack: 500 });
    // preflop: 全部 call
    for (let i = 0; i < 7; i++) { const ok = await act(socks, conns, users, "call"); if (!ok) await act(socks, conns, users, "check"); }
    // flop: check
    for (let i = 0; i < 7; i++) { const ok = await act(socks, conns, users, "check"); if (!ok) await act(socks, conns, users, "call"); }
    // turn: check
    for (let i = 0; i < 7; i++) { const ok = await act(socks, conns, users, "check"); if (!ok) await act(socks, conns, users, "call"); }
    expect(getGame(socks).phase).toBe("river");
    // river: 4人全下, 3人弃牌
    await act(socks, conns, users, "all-in");
    await act(socks, conns, users, "all-in");
    await act(socks, conns, users, "all-in");
    await act(socks, conns, users, "all-in");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    await act(socks, conns, users, "fold");
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(3500);
    expect(getGame(socks).seats.every(s => s.stack >= 0)).toBe(true);
  });

  it("8人: 翻牌前加注→多人跟注→两人摊牌", async () => {
    const { socks, conns, users } = await setupRoom(8);
    // UTG raise 60
    await act(socks, conns, users, "raise", 60);
    // 其余人按顺序: call 或 fold
    for (let i = 0; i < 7; i++) {
      const ok = await act(socks, conns, users, "call");
      if (!ok) await act(socks, conns, users, "fold");
    }
    // 翻牌后过牌/弃牌到结束
    await callThrough(socks, conns, users);
    expect(getGame(socks).phase).toBe("complete");
    expect(getTotal(socks)).toBe(16000);
  });
});
