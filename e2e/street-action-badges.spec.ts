import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:5173";

async function register(context:BrowserContext, prefix:string, nickname:string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await context.request.post(`${origin}/api/auth/register`, { data:{
    email:`${prefix}-${stamp}@local.test`, password:"test-pass-123", nickname:`${nickname}${stamp.slice(-3)}`
  }});
  expect(response.ok()).toBe(true);
  return `${nickname}${stamp.slice(-3)}`;
}

async function currentActor(pages:Page[]) {
  await expect.poll(async () => (await Promise.all(pages.map((page) => page.locator(".action-dock.my-turn").count()))).filter(Boolean).length).toBe(1);
  const counts = await Promise.all(pages.map((page) => page.locator(".action-dock.my-turn").count()));
  return pages[counts.findIndex(Boolean)];
}

async function submitAction(page:Page, selector:string) {
  const button = page.locator(selector);
  await expect(button).toBeEnabled();
  await button.evaluate((element) => (element as HTMLButtonElement).click());
}

async function seatUi(page:Page, seatId:string) {
  return page.locator(`.seat[data-seat-id="${seatId}"]`).evaluate((seat) => {
    const rect = (selector:string) => {
      const box = seat.querySelector<HTMLElement>(`:scope>${selector}`)!.getBoundingClientRect();
      return { left:box.left, top:box.top, width:box.width, height:box.height };
    };
    const action = seat.querySelector<HTMLElement>(":scope>.action-bubble");
    return {
      name:rect(".seat-name"), avatar:rect(".avatar-ring"), cards:rect(".seat-cards"),
      stack:rect(".seat-stack-line"),
      bet:seat.querySelector(":scope>.seat-bet") ? rect(".seat-bet") : null,
      dealer:seat.querySelector(":scope .dealer-button") ? rect(".seat-stack-line") : null,
      action:action ? { box:rect(".action-bubble"), text:action.textContent, kind:action.dataset.action, color:getComputedStyle(action).backgroundColor } : null,
    };
  });
}

test("同街动作替换昵称槽且换街全清", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "390x660 mobile contract");
  test.setTimeout(120_000);
  await page.setViewportSize({ width:390, height:660 });
  const contexts = [page.context(), await browser.newContext({ viewport:{ width:390, height:660 } }), await browser.newContext({ viewport:{ width:390, height:660 } })];
  const pages = [page, await contexts[1].newPage(), await contexts[2].newPage()];
  try {
    const hostNickname = await register(contexts[0], "street-host", "街道房主");
    await register(contexts[1], "street-one", "街道甲");
    await register(contexts[2], "street-two", "街道乙");
    const created = await contexts[0].request.post(`${origin}/api/rooms`, { data:{ durationMinutes:30, capacity:3, startingStack:200, smallBlind:1, bigBlind:2 } });
    expect(created.ok()).toBe(true);
    const { code } = await created.json() as { code:string };
    for (const playerPage of pages) {
      await playerPage.goto("/");
      await playerPage.locator(".public-room-list article", { hasText:hostNickname }).getByRole("button", { name:/加入/ }).click();
      await expect(playerPage.locator(".waiting-room")).toBeVisible();
      await playerPage.locator(".waiting-table-seat.empty").first().click();
    }
    await page.getByRole("button", { name:/开始牌局/ }).click();
    await Promise.all(pages.map((playerPage) => expect(playerPage.locator(".fresh-table")).toBeVisible()));

    const baseline = new Map<string, Awaited<ReturnType<typeof seatUi>>>();
    for (const seat of await page.locator(".seat[data-seat-id]").all()) {
      const seatId = (await seat.getAttribute("data-seat-id"))!;
      baseline.set(seatId, await seatUi(page, seatId));
    }
    await expect(page.locator(".action-bubble:not(.action-fold)")).toHaveCount(0);

    const first = await currentActor(pages);
    const firstId = (await first.locator(".hero-seat").getAttribute("data-seat-id"))!;
    await submitAction(first, ".action-buttons .action.call");
    await expect.poll(async () => {
      const response = await contexts[0].request.get(`${origin}/api/rooms/${code}`);
      const view = await response.json() as { room:{ game:{ seats:Array<{ id:string; streetAction?:string; lastAction?:string }> } } };
      return view.room.game.seats.find((seat) => seat.id === firstId);
    }).toMatchObject({ streetAction:"call" });
    await expect(page.locator(`.seat[data-seat-id="${firstId}"]>.action-call`)).toHaveText("跟注");
    const heroCall = first.locator(".hero-seat>.action-call");
    await expect(heroCall).toBeVisible();
    const heroCallUi = await seatUi(first, firstId);
    expect(heroCallUi.action?.box).toEqual(heroCallUi.name);
    await first.screenshot({ path:testInfo.outputPath("street-action-hero-call-390x660.png") });

    const second = await currentActor(pages);
    const secondId = (await second.locator(".hero-seat").getAttribute("data-seat-id"))!;
    await submitAction(second, ".action-buttons .action.call");
    await expect(page.locator(`.seat[data-seat-id="${secondId}"]>.action-call`)).toHaveText("跟注");

    const third = await currentActor(pages);
    const thirdId = (await third.locator(".hero-seat").getAttribute("data-seat-id"))!;
    await submitAction(third, ".action-buttons .action.check");
    await expect(page.locator(".board-cards .playing-card")).toHaveCount(3);
    await expect(page.locator(".action-bubble:not(.action-fold)")).toHaveCount(0);
    for (const [seatId, before] of baseline) {
      const after = await seatUi(page, seatId);
      expect({ avatar:after.avatar, cards:after.cards, stack:after.stack, dealer:after.dealer }).toEqual({ avatar:before.avatar, cards:before.cards, stack:before.stack, dealer:before.dealer });
    }

    const flopActor = await currentActor(pages);
    const flopActorId = (await flopActor.locator(".hero-seat").getAttribute("data-seat-id"))!;
    const beforeAction = await seatUi(page, flopActorId);
    await submitAction(flopActor, ".action-buttons .action.check");
    const badge = page.locator(`.seat[data-seat-id="${flopActorId}"]>.action-check`);
    await expect(badge).toHaveText("让牌");
    const withAction = await seatUi(page, flopActorId);
    expect(withAction.action?.box).toEqual(beforeAction.name);
    expect(withAction.action?.color).toBe("rgba(37, 190, 112, 0.91)");
    expect({ avatar:withAction.avatar, cards:withAction.cards, stack:withAction.stack, bet:withAction.bet, dealer:withAction.dealer }).toEqual({ avatar:beforeAction.avatar, cards:beforeAction.cards, stack:beforeAction.stack, bet:beforeAction.bet, dealer:beforeAction.dealer });
    await page.screenshot({ path:testInfo.outputPath("street-action-replaces-id-390x660.png") });
  } finally {
    await Promise.all(contexts.slice(1).map((context) => context.close()));
  }
});

test("四种本街动作具有独立文案和颜色", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "390x660 mobile palette");
  await page.setViewportSize({ width:390, height:660 });
  await page.setContent(`<!doctype html><style>
    html,body{margin:0;width:390px;height:660px}.app-shell.mode-mobile{width:390px;height:660px}.fresh-table{position:relative;width:390px;height:660px;background:#087e67}
    .seat{position:absolute!important;left:24px!important}.seat:nth-child(1){top:100px}.seat:nth-child(2){top:230px}.seat:nth-child(3){top:360px}.seat:nth-child(4){top:490px}
  </style><div class="app-shell mode-mobile"><main class="fresh-table">
    ${[["check","让牌"],["call","跟注"],["bet","下注"],["raise","加注"]].map(([kind,text]) => `<div class="seat opponent-seat"><b class="seat-name">玩家</b><div class="avatar-ring"></div><div class="seat-cards"></div><div class="seat-stack-line"><span class="seat-stack">200</span></div><div data-action="${kind}" class="action-bubble action-${kind}">${text}</div></div>`).join("")}
  </main></div>`);
  await page.addStyleTag({ path:"src/styles.css" });
  await page.addStyleTag({ path:"src/table-seats.css" });
  const palette = await page.locator(".action-bubble").evaluateAll((actions) => actions.map((action) => ({
    kind:(action as HTMLElement).dataset.action,
    text:action.textContent,
    color:getComputedStyle(action).backgroundColor,
    box:(() => { const box=action.getBoundingClientRect(); return { width:box.width, height:box.height }; })()
  })));
  expect(palette).toEqual([
    { kind:"check", text:"让牌", color:"rgba(37, 190, 112, 0.91)", box:{ width:92, height:12 } },
    { kind:"call", text:"跟注", color:"rgba(33, 184, 204, 0.91)", box:{ width:92, height:12 } },
    { kind:"bet", text:"下注", color:"rgba(35, 142, 228, 0.91)", box:{ width:92, height:12 } },
    { kind:"raise", text:"加注", color:"rgba(237, 139, 50, 0.91)", box:{ width:92, height:12 } },
  ]);
  await page.screenshot({ path:testInfo.outputPath("street-action-four-colours-390x660.png") });
});
