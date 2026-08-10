import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";

export interface SafeUser { id: string; email: string; nickname: string; avatar: string }
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createUser(email: string, password: string, nickname: string): SafeUser {
  const user = { id: randomUUID(), email: email.toLowerCase(), nickname, avatar: "🦊" };
  db.prepare("INSERT INTO users (id,email,password_hash,nickname,avatar,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, hashPassword(password), user.nickname, user.avatar, Date.now());
  db.prepare("INSERT INTO stats (user_id) VALUES (?)").run(user.id);
  return user;
}

export function authenticate(email: string, password: string): SafeUser | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as Record<string, string> | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, nickname: row.nickname, avatar: row.avatar };
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(tokenHash(token), userId, Date.now() + SESSION_TTL);
  return token;
}

export function destroySession(token?: string) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function userForSession(token?: string): SafeUser | null {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.email,u.nickname,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .get(tokenHash(token), Date.now()) as SafeUser | undefined;
  return row ?? null;
}

export const sessionMaxAge = SESSION_TTL / 1000;
