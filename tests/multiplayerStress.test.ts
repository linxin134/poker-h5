import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, legalActions, startHand } from "../src/game/engine";
import type { Card, PlayerAction, PokerState } from "../src/game/types";

function seededRandom(initialSeed: number) {
  let seed = initialSeed;
  return () => ((seed = seed * 48271 % 2147483647) / 2147483647);
}

function assertChipLedger(state: PokerState, expectedTotal: number) {
  const accounted = state.seats.reduce((sum, seat) => sum + seat.stack + seat.bet, 0) + state.pot;
  expect(accounted).toBe(expectedTotal);
  expect(state.seats.every((seat) => Number.isInteger(seat.stack) && seat.stack >= 0)).toBe(true);
  expect(state.seats.every((seat) => Number.isInteger(seat.bet) && seat.bet >= 0)).toBe(true);
  expect(state.seats.every((seat) => Number.isInteger(seat.totalContribution) && seat.totalContribution >= 0)).toBe(true);
}

function chooseAction(state: PokerState, random: () => number): { action: PlayerAction; raiseTo?: number } {
  const legal = legalActions(state);
  const roll = random();
  if (legal.actions.includes("all-in") && roll < 0.06) return { action: "all-in" };
  if (legal.actions.includes("raise") && roll < 0.24) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    const raiseTo = legal.minRaiseTo + Math.floor(random() * (span + 1));
    return { action: "raise", raiseTo };
  }
  if (legal.actions.includes("fold") && roll < 0.34) return { action: "fold" };
  return { action: legal.actions.includes("check") ? "check" : "call" };
}

describe("complex multiplayer accounting", () => {
  it("keeps every chip accounted for across 2-9 players, uneven stacks and hundreds of hands", () => {
    const actionCoverage = new Set<PlayerAction>();
    let completedHands = 0;
    let showdownHands = 0;
    let foldHands = 0;
    let unequalContributionShowdowns = 0;

    for (let playerCount = 2; playerCount <= 9; playerCount += 1) {
      for (let scenario = 1; scenario <= 5; scenario += 1) {
        const random = seededRandom(playerCount * 10_000 + scenario * 97);
        const openingStacks = Array.from({ length: playerCount }, (_, index) => 1_800 + index * 137);
        const expectedTotal = openingStacks.reduce((sum, stack) => sum + stack, 0);
        const cumulativeDeltas = new Map<string, number>();
        let state = createInitialState(openingStacks.map((stack, index) => ({
          id: `p${index}`,
          name: `Player ${index}`,
          avatar: "",
          stack,
          isHuman: true
        })), 5, 10);

        for (let hand = 0; hand < 14 && state.seats.filter((seat) => seat.stack > 0).length >= 2; hand += 1) {
          state = startHand(state, random);
          assertChipLedger(state, expectedTotal);
          const opening = { ...state.handStartStacks };
          let actionCount = 0;

          while (state.phase !== "complete" && actionCount < 400) {
            const actor = state.seats[state.actorIndex];
            expect(actor).toBeDefined();
            const choice = chooseAction(state, random);
            actionCoverage.add(choice.action);
            state = applyAction(state, actor.id, choice.action, choice.raiseTo);
            assertChipLedger(state, expectedTotal);

            const visibleCards = [
              ...state.deck,
              ...state.board,
              ...state.seats.flatMap((seat) => seat.holeCards)
            ];
            expect(new Set(visibleCards).size).toBe(visibleCards.length);
            expect(state.board.length).toBeLessThanOrEqual(5);
            actionCount += 1;
          }

          expect(actionCount).toBeLessThan(400);
          expect(state.phase).toBe("complete");
          expect(state.pot).toBe(0);
          expect(state.seats.every((seat) => seat.bet === 0)).toBe(true);

          const handDeltas = state.seats.map((seat) => seat.stack - opening[seat.id]);
          expect(handDeltas.reduce((sum, delta) => sum + delta, 0)).toBe(0);
          for (let index = 0; index < state.seats.length; index += 1) {
            const seat = state.seats[index];
            cumulativeDeltas.set(seat.id, (cumulativeDeltas.get(seat.id) ?? 0) + handDeltas[index]);
            expect(cumulativeDeltas.get(seat.id)).toBe(seat.stack - openingStacks[index]);
          }

          completedHands += 1;
          if (state.result?.reason === "showdown") {
            showdownHands += 1;
            const liveContributions = new Set(state.seats.filter((seat) => !seat.folded).map((seat) => seat.totalContribution));
            if (liveContributions.size > 1) unequalContributionShowdowns += 1;
          } else {
            foldHands += 1;
          }
        }
      }
    }

    expect(completedHands).toBeGreaterThan(250);
    expect(showdownHands).toBeGreaterThan(50);
    expect(foldHands).toBeGreaterThan(50);
    expect(unequalContributionShowdowns).toBeGreaterThan(10);
    expect(actionCoverage).toEqual(new Set<PlayerAction>(["fold", "check", "call", "raise", "all-in"]));
  });

  it("pays four nested pots exactly and keeps folded dead money in the ledger", () => {
    let state = riverState({
      board: ["2♣", "3♦", "7♥", "8♠", "9♣"],
      pot: 950,
      actorIndex: 3,
      seats: [
        { id: "a", cards: ["A♠", "A♥"], stack: 0, contribution: 50, allIn: true },
        { id: "b", cards: ["K♠", "K♥"], stack: 0, contribution: 100, allIn: true },
        { id: "c", cards: ["Q♠", "Q♥"], stack: 0, contribution: 200, allIn: true },
        { id: "d", cards: ["J♠", "J♥"], stack: 1, contribution: 300 },
        { id: "e", cards: ["4♠", "5♥"], stack: 0, contribution: 300, folded: true, allIn: true }
      ]
    });

    state = applyAction(state, "d", "check");
    expect(state.phase).toBe("complete");
    expect(state.result?.pot).toBe(950);
    expect(state.seats.map((seat) => seat.stack)).toEqual([250, 200, 300, 201, 0]);
    expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(951);
    expect(state.result?.winnerSeatIds).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
  });
});

function riverState({ board, pot, actorIndex, seats }: {
  board: Card[];
  pot: number;
  actorIndex: number;
  seats: Array<{ id: string; cards: [Card, Card]; stack: number; contribution: number; folded?: boolean; allIn?: boolean }>;
}): PokerState {
  const state = createInitialState(seats.map((seat) => ({
    id: seat.id,
    name: seat.id.toUpperCase(),
    avatar: "",
    stack: seat.stack,
    isHuman: true
  })), 1, 2);
  state.phase = "river";
  state.dealerIndex = 0;
  state.actorIndex = actorIndex;
  state.board = board;
  state.deck = [];
  state.pot = pot;
  state.currentBet = 0;
  state.minRaise = 2;
  state.actedThisRound = [];
  state.seats.forEach((seat, index) => Object.assign(seat, {
    holeCards: seats[index].cards,
    stack: seats[index].stack,
    totalContribution: seats[index].contribution,
    folded: seats[index].folded ?? false,
    allIn: seats[index].allIn ?? false,
    bet: 0
  }));
  return state;
}
