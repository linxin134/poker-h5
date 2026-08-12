import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { resolve } from "node:path";
import { z } from "zod";
import { db } from "./db";
import { authenticate, createSession, createUser, destroySession, sessionMaxAge, userForSession } from "./auth";
import { roomService } from "./rooms";

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
await app.register(cookie);
await app.register(websocket);
const secure = process.env.COOKIE_SECURE === "true";
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: sessionMaxAge };
const release = process.env.APP_RELEASE ?? "dev";

app.setErrorHandler((error, _request, reply) => {
  const validationError = error instanceof z.ZodError || (error as { name?: string }).name === "ZodError";
  const statusCode = validationError ? 400 : (error as { statusCode?: number }).statusCode ?? 500;
  const message = error instanceof Error ? error.message : "请求参数错误";
  reply.code(statusCode).send({ message: statusCode === 500 ? "服务器开小差了" : message });
});

const credentials = z.object({ email: z.string().email().max(160), password: z.string().min(8).max(128) });
const registerBody = credentials.extend({ nickname: z.string().trim().min(2).max(20) });
const requireUser = (request: { cookies: Record<string, string | undefined> }) => {
  const user = userForSession(request.cookies.poker_session);
  if (!user) throw Object.assign(new Error("请先登录"), { statusCode: 401 });
  return user;
};

app.get("/api/health", async () => ({ ok: true, time: Date.now(), release }));
app.get("/api/version", async (_request, reply) => {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
  return { release };
});
app.get("/api/auth/me", async (request) => ({ user: userForSession(request.cookies.poker_session) }));
app.post("/api/auth/register", async (request, reply) => {
  const body = registerBody.parse(request.body);
  try {
    const user = createUser(body.email, body.password, body.nickname);
    reply.setCookie("poker_session", createSession(user.id), cookieOptions);
    return { user };
  } catch (error) {
    if (String(error).includes("UNIQUE")) return reply.code(409).send({ message: "该邮箱已注册" });
    throw error;
  }
});
app.post("/api/auth/login", async (request, reply) => {
  const body = credentials.parse(request.body);
  const user = authenticate(body.email, body.password);
  if (!user) return reply.code(401).send({ message: "邮箱或密码错误" });
  reply.setCookie("poker_session", createSession(user.id), cookieOptions);
  return { user };
});
app.post("/api/auth/logout", async (request, reply) => {
  destroySession(request.cookies.poker_session);
  reply.clearCookie("poker_session", { path: "/" });
  return { ok: true };
});
app.put("/api/profile", async (request) => {
  const user = requireUser(request);
  const body = z.object({
    nickname: z.string().trim().min(2).max(20),
    avatar: z.string().min(1).max(250_000).refine((value) => /^avatar-[0-7]$/.test(value) || /^data:image\/(?:png|jpeg|webp);base64,/.test(value), { message: "头像格式不支持" })
  }).parse(request.body);
  db.prepare("UPDATE users SET nickname=?,avatar=? WHERE id=?").run(body.nickname, body.avatar, user.id);
  const updatedUser = { ...user, ...body };
  roomService.updateProfile(updatedUser);
  return { user: updatedUser };
});
app.get("/api/save", async (request) => {
  const user = requireUser(request);
  const row = db.prepare("SELECT state_json,saved_at FROM saves WHERE user_id=?").get(user.id) as { state_json: string; saved_at: number } | undefined;
  return { state: row ? JSON.parse(row.state_json) : null, savedAt: row?.saved_at ?? null };
});
app.put("/api/save", async (request) => {
  const user = requireUser(request);
  const body = z.object({ state: z.record(z.string(), z.unknown()) }).parse(request.body);
  const savedAt = Date.now();
  db.prepare("INSERT INTO saves(user_id,state_json,saved_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,saved_at=excluded.saved_at")
    .run(user.id, JSON.stringify(body.state), savedAt);
  return { savedAt };
});
app.get("/api/stats", async (request) => {
  const user = requireUser(request);
  const row = db.prepare("SELECT hands,wins,profit,biggest_pot AS biggestPot FROM stats WHERE user_id=?").get(user.id);
  return row ?? { hands: 0, wins: 0, profit: 0, biggestPot: 0 };
});
app.post("/api/stats", async (request) => {
  const user = requireUser(request);
  const body = z.object({ hands: z.number().int().min(0), wins: z.number().int().min(0), profit: z.number().int(), biggestPot: z.number().int().min(0) }).parse(request.body);
  db.prepare("UPDATE stats SET hands=hands+?,wins=wins+?,profit=profit+?,biggest_pot=MAX(biggest_pot,?) WHERE user_id=?")
    .run(body.hands, body.wins, body.profit, body.biggestPot, user.id);
  return { ok: true };
});

app.get("/api/history", async (request) => {
  const user = requireUser(request);
  const rows = db.prepare("SELECT room_code AS roomCode,result_json AS resultJson FROM room_hands ORDER BY created_at DESC LIMIT 500")
    .all() as Array<{ roomCode: string; resultJson: string }>;
  const records = rows.flatMap((row) => {
    try {
      const hand = JSON.parse(row.resultJson) as import("../src/multiplayer/types").RoomHandRecord;
      return [{ ...hand, roomCode: row.roomCode }];
    } catch {
      return [];
    }
  });
  const belongsToUser = (hand: (typeof records)[number]) => hand.seats.some((seat) => seat.userId === user.id || (!seat.userId && seat.nickname === user.nickname));
  const hands = records.filter(belongsToUser).slice(0, 100);
  const roomGroups = new Map<string, typeof records>();
  for (const hand of records) {
    const group = roomGroups.get(hand.roomCode) ?? [];
    group.push(hand);
    roomGroups.set(hand.roomCode, group);
  }
  const rooms = [...roomGroups.entries()].flatMap(([roomCode, roomHands]) => {
    if (!roomHands.some(belongsToUser)) return [];
    const scores = new Map<string, { userId?: string; nickname: string; avatar: string; delta: number; finalStack: number }>();
    for (const hand of roomHands) {
      for (const seat of hand.seats) {
        const key = seat.userId ?? `nickname:${seat.nickname}`;
        const previous = scores.get(key);
        scores.set(key, {
          userId: seat.userId,
          nickname: previous?.nickname ?? seat.nickname,
          avatar: previous?.avatar ?? seat.avatar,
          delta: (previous?.delta ?? 0) + seat.delta,
          finalStack: previous?.finalStack ?? seat.finalStack
        });
      }
    }
    return [{
      roomCode,
      handCount: roomHands.length,
      completedAt: Math.max(...roomHands.map((hand) => hand.completedAt)),
      scoreboard: [...scores.values()].sort((a, b) => b.delta - a.delta || b.finalStack - a.finalStack || a.nickname.localeCompare(b.nickname, "zh-CN"))
    }];
  }).sort((a, b) => b.completedAt - a.completedAt);
  return { hands, rooms };
});

const roomOptions = z.object({
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  capacity: z.number().int().min(3).max(9),
  startingStack: z.number().int().min(100).max(100_000),
  smallBlind: z.number().int().min(1).max(5_000),
  bigBlind: z.number().int().min(2).max(10_000)
}).refine((value) => value.bigBlind >= value.smallBlind * 2, { message: "大盲至少是小盲的两倍" });

app.post("/api/rooms", async (request) => {
  const user = requireUser(request);
  return roomService.create(user, roomOptions.parse(request.body));
});

app.get("/api/rooms", async () => ({ rooms: roomService.list() }));

app.post("/api/rooms/:code/join", async (request) => {
  const user = requireUser(request);
  const { code } = z.object({ code: z.string().min(4).max(12) }).parse(request.params);
  return roomService.join(code, user);
});

app.get("/api/rooms/:code", async (request) => {
  const user = requireUser(request);
  const { code } = z.object({ code: z.string().min(4).max(12) }).parse(request.params);
  return { room: roomService.view(code, user.id) };
});

app.get("/api/rooms/:code/socket", { websocket: true }, (socket, request) => {
  const user = userForSession(request.cookies.poker_session);
  const code = String((request.params as { code?: string }).code ?? "");
  if (!user) {
    socket.send(JSON.stringify({ type: "error", message: "请先登录" }));
    socket.close(1008, "Unauthorized");
    return;
  }
  try {
    const connection = roomService.connect(code, user, socket);
    socket.on("message", (message: { toString(): string }) => connection.message(message.toString()));
    socket.on("close", () => connection.close());
  } catch (error) {
    socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "连接房间失败" }));
    socket.close(1008, "Room unavailable");
  }
});

await app.register(staticPlugin, {
  root: resolve("dist"),
  wildcard: false,
  setHeaders(response, path) {
    if (path.endsWith("index.html")) response.header("Cache-Control", "no-store, no-cache, must-revalidate");
    else if (/[\\/]assets[\\/]/.test(path)) response.header("Cache-Control", "public, max-age=31536000, immutable");
  }
});
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) return reply.code(404).send({ message: "接口不存在" });
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
  return reply.sendFile("index.html");
});

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8787) });
