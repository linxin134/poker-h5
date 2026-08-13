import { expect, test } from "@playwright/test";

test.use({ viewport: { width:390, height:660 } });

test("390x660 playing cards use the video palette and keep large ranks clear of suits", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.innerHTML = `
      <main class="app-shell mode-mobile">
        <section class="fresh-table card-palette-fixture" aria-label="牌面四色视觉测试">
          <div class="board-zone">
            <div class="board-cards">
              ${[
                ["10", "♠", "spades"],
                ["J", "♥", "hearts"],
                ["Q", "♦", "diamonds"],
                ["K", "♣", "clubs"]
              ].map(([rank, suit, name]) => `<div class="playing-card face-card suit-${name}" data-rank="${rank}" data-suit="${name}"><span class="card-corner card-corner-top"><b>${rank}</b><i>${suit}</i></span></div>`).join("")}
            </div>
          </div>
        </section>
      </main>`;
  });

  const cards = page.locator(".playing-card");
  await expect(cards).toHaveCount(4);
  const expectedColours = ["rgb(23, 35, 38)", "rgb(228, 76, 84)", "rgb(45, 118, 214)", "rgb(40, 167, 92)"];
  const measurements = await cards.evaluateAll((elements) => elements.map((element) => {
    const rank = element.querySelector<HTMLElement>(".card-corner-top b")!;
    const suit = element.querySelector<HTMLElement>(".card-corner-top i")!;
    const rankBox = rank.getBoundingClientRect();
    const suitBox = suit.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      colour:getComputedStyle(suit).color,
      background:style.backgroundColor,
      rankBottom:rankBox.bottom,
      suitTop:suitBox.top,
      suitInside:suitBox.left >= element.getBoundingClientRect().left && suitBox.right <= element.getBoundingClientRect().right
    };
  }));

  expect(measurements.map((card) => card.colour)).toEqual(expectedColours);
  for (const card of measurements) {
    expect(card.background).toBe("rgb(242, 243, 239)");
    expect(card.suitTop).toBeGreaterThanOrEqual(card.rankBottom);
    expect(card.suitInside).toBe(true);
  }

  await page.screenshot({ path:testInfo.outputPath("four-colour-face-cards-390x660.png") });
});
