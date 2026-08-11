import { expect, test } from "@playwright/test";

test("账号会话与服务端房间参数校验", async ({ page }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const email = `api-${stamp}@local.test`;
  const password = "test-pass-123";
  const api = page.context().request;

  const register = await api.post("/api/auth/register", { data: { email, password, nickname: "接口牌手" } });
  expect(register.ok()).toBe(true);
  expect((await api.get("/api/auth/me")).ok()).toBe(true);

  const profile = await api.put("/api/profile", { data: { nickname: "新昵称牌手", avatar: "avatar-6" } });
  expect(profile.ok()).toBe(true);
  expect(await profile.json()).toMatchObject({ user: { nickname: "新昵称牌手", avatar: "avatar-6" } });
  const me = await (await api.get("/api/auth/me")).json() as { user: { nickname: string; avatar: string } };
  expect(me.user).toMatchObject({ nickname: "新昵称牌手", avatar: "avatar-6" });
  const history = await api.get("/api/history");
  expect(history.ok()).toBe(true);
  expect(await history.json()).toEqual({ hands: [], rooms: [] });

  const duplicate = await api.post("/api/auth/register", { data: { email, password, nickname: "重复牌手" } });
  expect(duplicate.status()).toBe(409);

  const tooSmall = await api.post("/api/rooms", { data: { durationMinutes: 30, capacity: 2, startingStack: 200, smallBlind: 1, bigBlind: 2 } });
  expect(tooSmall.status()).toBe(400);
  const badBlind = await api.post("/api/rooms", { data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 2, bigBlind: 3 } });
  expect(badBlind.status()).toBe(400);

  expect((await api.post("/api/auth/logout")).ok()).toBe(true);
  expect((await api.post("/api/rooms", { data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 } })).status()).toBe(401);
  expect((await api.post("/api/auth/login", { data: { email, password: "wrong-pass" } })).status()).toBe(401);
  expect((await api.post("/api/auth/login", { data: { email, password } })).ok()).toBe(true);
});

test("旁观成员不占用可落座容量", async ({ page, browser }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const contexts = [page.context(), await browser.newContext(), await browser.newContext(), await browser.newContext()];
  try {
    for (let index = 0; index < contexts.length; index += 1) {
      const response = await contexts[index].request.post("http://127.0.0.1:5173/api/auth/register", {
        data: { email: `spectator-${index}-${stamp}@local.test`, password: "test-pass-123", nickname: `旁观${index}` }
      });
      expect(response.ok()).toBe(true);
    }
    const created = await contexts[0].request.post("http://127.0.0.1:5173/api/rooms", {
      data: { durationMinutes: 30, capacity: 3, startingStack: 200, smallBlind: 1, bigBlind: 2 }
    });
    const { code } = await created.json() as { code: string };
    for (const context of contexts.slice(1)) {
      const joined = await context.request.post(`http://127.0.0.1:5173/api/rooms/${code}/join`);
      expect(joined.ok()).toBe(true);
    }
    const view = await contexts[0].request.get(`http://127.0.0.1:5173/api/rooms/${code}`);
    const body = await view.json() as { room: { capacity: number; members: Array<{ seatIndex: number | null }> } };
    expect(body.room.capacity).toBe(3);
    expect(body.room.members).toHaveLength(4);
    expect(body.room.members.every((member) => member.seatIndex === null)).toBe(true);
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});

test("普通退出保留房间，只有房主解散后才从大厅移除", async ({ page }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`;
  const email = `lifecycle-${stamp}@local.test`;
  const password = "test-pass-123";
  const api = page.context().request;

  expect((await api.post("/api/auth/register", { data: { email, password, nickname: "生命周期房主" } })).ok()).toBe(true);
  const created = await api.post("/api/rooms", { data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 } });
  const { code } = await created.json() as { code: string };
  expect((await api.post("/api/auth/logout")).ok()).toBe(true);

  const afterLeave = await (await api.get("/api/rooms")).json() as { rooms: Array<{ code: string }> };
  expect(afterLeave.rooms.some((room) => room.code === code)).toBe(true);

  expect((await api.post("/api/auth/login", { data: { email, password } })).ok()).toBe(true);
  await page.goto("/");
  const message = await page.evaluate((roomCode) => new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/rooms/${roomCode}/socket`);
    const timeout = window.setTimeout(() => reject(new Error("dissolve timeout")), 3_000);
    socket.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as { type: string; message?: string };
      if (payload.type === "room") socket.send(JSON.stringify({ type: "dissolve" }));
      if (payload.type === "dissolved") {
        window.clearTimeout(timeout);
        socket.close();
        resolve(payload.message ?? "");
      }
    };
  }), code);
  expect(message).toContain("解散");

  const afterDissolve = await (await api.get("/api/rooms")).json() as { rooms: Array<{ code: string }> };
  expect(afterDissolve.rooms.some((room) => room.code === code)).toBe(false);
});
