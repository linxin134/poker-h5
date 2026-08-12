import { expect, test } from "@playwright/test";

test("waiting-room missing-player prompt is half-width and centered at 390x660", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile waiting-room layout coverage");
  await page.setViewportSize({ width: 390, height: 660 });
  const stamp = `${Date.now()}-${testInfo.workerIndex}`;
  await page.goto("http://127.0.0.1:5173/");
  const registered = await page.request.post("/api/auth/register", {
    data: { email: `waiting-ui-${stamp}@local.test`, password: "test-pass-123", nickname: "提示验收" }
  });
  expect(registered.ok()).toBe(true);
  const created = await page.request.post("/api/rooms", {
    data: { durationMinutes: 30, capacity: 6, startingStack: 200, smallBlind: 1, bigBlind: 2 }
  });
  const { code } = await created.json() as { code: string };
  await page.evaluate((roomCode) => sessionStorage.setItem("poker-active-room", roomCode), code);
  await page.reload();
  await page.locator(".waiting-table-seat.empty").first().click();

  const prompt = page.getByRole("button", { name: "还需 1 人落座" });
  await expect(prompt).toBeDisabled();
  const geometry = await prompt.evaluate((element) => {
    const promptRect = element.getBoundingClientRect();
    const centerRect = document.querySelector(".waiting-table-center")!.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      widthRatio: promptRect.width / centerRect.width,
      centered: Math.abs(promptRect.left + promptRect.width / 2 - (centerRect.left + centerRect.width / 2)),
      oneLine: element.scrollHeight <= element.clientHeight,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      verticalOverflow: document.documentElement.scrollHeight - innerHeight
    };
  });
  expect(geometry.viewport).toEqual({ width: 390, height: 660 });
  expect(geometry.widthRatio).toBeLessThanOrEqual(.51);
  expect(geometry.centered).toBeLessThanOrEqual(1);
  expect(geometry.oneLine).toBe(true);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(geometry.verticalOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("waiting-room-one-player.png") });
});
