import { evaluateHand, compareScores, shuffleDeck } from "./cards";
import { buildSidePots } from "./pots";
import type { ActionRecord, GameEvent, LegalActions, PlayerAction, PokerState, Seat } from "./types";

const uid = () => crypto.randomUUID();
const clone = (state: PokerState): PokerState => structuredClone(state);

function record(state: PokerState, detail: string, type: string, seatId?: string, amount?: number) {
  state.history.push({ id: uid(), at: Date.now(), phase: state.phase, seatId, type, amount, detail } as ActionRecord);
}

function event(state: PokerState, type: GameEvent["type"], seatId?: string, payload?: Record<string, unknown>) {
  state.events.push({ id: uid(), type, seatId, payload });
}

const eligible = (seat: Seat) => !seat.folded && !seat.allIn && seat.stack > 0;
const live = (seat: Seat) => !seat.folded;

export function createInitialState(seats: Pick<Seat, "id" | "name" | "avatar" | "stack" | "isHuman">[], smallBlind = 10, bigBlind = 20): PokerState {
  return {
    handId: uid(), handNumber: 0, startingStack: seats[0]?.stack ?? 0, phase: "idle",
    seats: seats.map((seat) => ({ ...seat, holeCards: [], bet: 0, totalContribution: 0, folded: false, allIn: false })),
    dealerIndex: -1, smallBlind, bigBlind, actorIndex: -1, board: [], deck: [], pot: 0,
    currentBet: 0, minRaise: bigBlind, actedThisRound: [], history: [], events: [], handStartStacks: {}
  };
}

function nextIndex(state: PokerState, from: number, predicate: (seat: Seat) => boolean): number {
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const index = (from + offset) % state.seats.length;
    if (predicate(state.seats[index])) return index;
  }
  return -1;
}

function commit(seat: Seat, requested: number): number {
  const amount = Math.max(0, Math.min(requested, seat.stack));
  seat.stack -= amount;
  seat.bet += amount;
  seat.totalContribution += amount;
  seat.allIn = seat.stack === 0;
  return amount;
}

export function startHand(input: PokerState, random = Math.random): PokerState {
  const state = clone(input);
  if (state.seats.filter((seat) => seat.stack > 0).length < 2) throw new Error("至少需要两名有筹码的玩家");
  state.handId = uid();
  state.handNumber += 1;
  state.phase = "preflop";
  state.board = [];
  state.deck = shuffleDeck(undefined, random);
  state.pot = 0;
  state.currentBet = state.bigBlind;
  state.minRaise = state.bigBlind;
  state.actedThisRound = [];
  state.history = [];
  state.events = [];
  state.winnerText = undefined;
  state.result = undefined;
  state.handStartStacks = Object.fromEntries(state.seats.map((seat) => [seat.id, seat.stack]));
  state.seats.forEach((seat) => Object.assign(seat, { holeCards: [], bet: 0, totalContribution: 0, folded: seat.stack <= 0, allIn: false, lastAction: undefined }));
  state.dealerIndex = nextIndex(state, state.dealerIndex, (seat) => seat.stack > 0);
  const sb = nextIndex(state, state.dealerIndex, (seat) => seat.stack > 0);
  const bb = nextIndex(state, sb, (seat) => seat.stack > 0);
  for (let round = 0; round < 2; round += 1) {
    for (const seat of state.seats) if (!seat.folded) seat.holeCards.push(state.deck.pop()!);
  }
  commit(state.seats[sb], state.smallBlind);
  commit(state.seats[bb], state.bigBlind);
  state.seats[sb].lastAction = `小盲 ${state.smallBlind}`;
  state.seats[bb].lastAction = `大盲 ${state.bigBlind}`;
  state.actorIndex = nextIndex(state, bb, eligible);
  record(state, `第 ${state.handNumber} 局开始`, "hand-start");
  event(state, "deal");
  event(state, "turn", state.seats[state.actorIndex]?.id);
  return state;
}

export function legalActions(state: PokerState, seatIndex = state.actorIndex): LegalActions {
  const seat = state.seats[seatIndex];
  if (!seat || seatIndex !== state.actorIndex || !eligible(seat)) return { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0 };
  const callAmount = Math.max(0, Math.min(state.currentBet - seat.bet, seat.stack));
  const actions: PlayerAction[] = ["fold"];
  if (callAmount === 0) actions.push("check"); else actions.push("call");
  const minRaiseTo = state.currentBet + state.minRaise;
  const maxRaiseTo = seat.bet + seat.stack;
  if (maxRaiseTo > state.currentBet && maxRaiseTo >= minRaiseTo) actions.push("raise");
  if (seat.stack > 0) actions.push("all-in");
  return { actions, callAmount, minRaiseTo: Math.min(minRaiseTo, maxRaiseTo), maxRaiseTo };
}

function bettingRoundComplete(state: PokerState): boolean {
  const actors = state.seats.filter(eligible);
  if (actors.length === 0) return true;
  return actors.every((seat) => state.actedThisRound.includes(seat.id) && seat.bet === state.currentBet);
}

function sweepBets(state: PokerState) {
  const amount = state.seats.reduce((sum, seat) => sum + seat.bet, 0);
  state.pot += amount;
  state.seats.forEach((seat) => { seat.bet = 0; });
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.actedThisRound = [];
}

function finishByFold(state: PokerState) {
  sweepBets(state);
  const winner = state.seats.find(live)!;
  const settledPot = state.pot;
  winner.stack += settledPot;
  state.winnerText = `${winner.name} 赢得 ${settledPot} 筹码`;
  state.result = { winnerSeatIds: [winner.id], pot: settledPot, reason: "fold" };
  record(state, state.winnerText, "win", winner.id, settledPot);
  event(state, "win", winner.id, { amount: settledPot });
  state.pot = 0;
  state.phase = "complete";
  state.actorIndex = -1;
}

function showdown(state: PokerState) {
  sweepBets(state);
  state.phase = "showdown";
  const settledPot = state.pot;
  const scores = new Map(state.seats.filter(live).map((seat) => [seat.id, evaluateHand([...seat.holeCards, ...state.board])]));
  const winners = new Set<string>();
  for (const pot of buildSidePots(state.seats)) {
    const candidates = pot.eligibleSeatIds.map((id) => ({ id, score: scores.get(id)! }));
    const best = candidates.sort((a, b) => compareScores(b.score, a.score))[0].score;
    const tied = candidates.filter((entry) => compareScores(entry.score, best) === 0);
    const share = Math.floor(pot.amount / tied.length);
    tied.forEach((entry, index) => {
      const seat = state.seats.find((item) => item.id === entry.id)!;
      seat.stack += share + (index < pot.amount % tied.length ? 1 : 0);
      winners.add(entry.id);
    });
  }
  const names = [...winners].map((id) => state.seats.find((seat) => seat.id === id)!.name);
  const bestName = scores.get([...winners][0])?.name ?? "胜出";
  state.winnerText = `${names.join("、")} 以${bestName}赢得底池`;
  state.result = { winnerSeatIds: [...winners], pot: settledPot, reason: "showdown", handName: bestName };
  record(state, state.winnerText, "showdown");
  event(state, "showdown");
  event(state, "win", [...winners][0], { amount: settledPot });
  state.pot = 0;
  state.phase = "complete";
  state.actorIndex = -1;
}

function advanceStreet(state: PokerState) {
  sweepBets(state);
  if (state.phase === "preflop") { state.phase = "flop"; state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!); }
  else if (state.phase === "flop") { state.phase = "turn"; state.board.push(state.deck.pop()!); }
  else if (state.phase === "turn") { state.phase = "river"; state.board.push(state.deck.pop()!); }
  else { showdown(state); return; }
  record(state, `${state.phase} 发牌`, "street");
  event(state, "street", undefined, { phase: state.phase });
  state.actorIndex = nextIndex(state, state.dealerIndex, eligible);
  if (state.actorIndex < 0) advanceStreet(state);
  else event(state, "turn", state.seats[state.actorIndex].id);
}

export function applyAction(input: PokerState, seatId: string, action: PlayerAction, raiseTo?: number): PokerState {
  const state = clone(input);
  const seatIndex = state.seats.findIndex((seat) => seat.id === seatId);
  const seat = state.seats[seatIndex];
  const legal = legalActions(state, seatIndex);
  if (!legal.actions.includes(action)) throw new Error("当前操作不合法");
  if (action === "fold") { seat.folded = true; seat.lastAction = "弃牌"; event(state, "fold", seat.id); }
  if (action === "check") seat.lastAction = "过牌";
  if (action === "call") { const amount = commit(seat, legal.callAmount); seat.lastAction = `跟注 ${amount}`; event(state, "chips", seat.id, { amount }); }
  if (action === "raise" || action === "all-in") {
    const target = action === "all-in" ? legal.maxRaiseTo : Math.max(legal.minRaiseTo, Math.min(raiseTo ?? legal.minRaiseTo, legal.maxRaiseTo));
    const previous = state.currentBet;
    const amount = commit(seat, target - seat.bet);
    if (seat.bet > previous) {
      state.minRaise = Math.max(state.minRaise, seat.bet - previous);
      state.currentBet = seat.bet;
      state.actedThisRound = [];
    }
    seat.lastAction = action === "all-in" ? `全下 ${seat.bet}` : `加注至 ${seat.bet}`;
    event(state, "chips", seat.id, { amount, allIn: action === "all-in" });
  }
  state.actedThisRound.push(seat.id);
  record(state, seat.lastAction ?? action, action, seat.id, seat.bet);
  if (state.seats.filter(live).length === 1) { finishByFold(state); return state; }
  if (bettingRoundComplete(state)) { advanceStreet(state); return state; }
  state.actorIndex = nextIndex(state, seatIndex, eligible);
  if (state.actorIndex < 0) advanceStreet(state);
  else event(state, "turn", state.seats[state.actorIndex].id);
  return state;
}

export function drainEvents(input: PokerState): PokerState {
  return { ...input, events: [] };
}
