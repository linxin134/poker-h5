import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayingCard } from "../src/components/PlayingCard";
import type { Card } from "../src/game/types";

describe("PlayingCard suit contract", () => {
  it.each([
    ["A♠", "spades", "♠"],
    ["Q♥", "hearts", "♥"],
    ["10♦", "diamonds", "♦"],
    ["K♣", "clubs", "♣"]
  ])("renders %s with an explicit four-colour suit hook", (label, suitName, suit) => {
    const card = label.replace("10", "T") as Card;
    const html = renderToStaticMarkup(createElement(PlayingCard, { card }));
    expect(html).toContain(`suit-${suitName}`);
    expect(html).toContain(`data-suit="${suitName}"`);
    expect(html).toContain(`<i>${suit}</i>`);
  });

  it.each(["T♠", "J♥", "Q♦", "K♣"] as Card[])("keeps the suit in a dedicated corner row for %s", (card) => {
    const html = renderToStaticMarkup(createElement(PlayingCard, { card }));
    const label = card[0] === "T" ? "10" : card[0];
    expect(html).toContain(`data-rank="${label}"`);
    expect(html).toMatch(new RegExp(`<span class="card-corner card-corner-top"><b>${label}</b><i>[^<]</i></span>`));
  });

  it("does not expose a suit hook on a card back", () => {
    const html = renderToStaticMarkup(createElement(PlayingCard, { hidden:true }));
    expect(html).toContain("card-back");
    expect(html).not.toContain("data-suit=");
  });
});
