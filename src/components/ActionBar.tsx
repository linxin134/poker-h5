import { useEffect, useState } from "react";
import { legalActions } from "../game/engine";
import type { PlayerAction, PokerState } from "../game/types";
import { GameAvatar } from "./GameAvatar";

type QueuedAction = "check-fold" | "fold" | null;

export function ActionBar({ game, mySeatId, turnRemainingMs, onAct }: { game: PokerState; mySeatId: string; turnRemainingMs: number; onAct(action: PlayerAction, raiseTo?: number): void }) {
  const legal = legalActions(game);
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [quickPreset, setQuickPreset] = useState<string | null>(null);
  const [queuedAction, setQueuedAction] = useState<QueuedAction>(null);
  const actor = game.seats[game.actorIndex];
  const isMyTurn = actor?.id === mySeatId;
  const legalKey = legal.actions.join(",");
  useEffect(() => { setRaiseTo(legal.minRaiseTo); setRaiseOpen(false); setQuickPreset(null); }, [game.actorIndex, legal.minRaiseTo]);
  useEffect(() => setQueuedAction(null), [game.handId]);
  useEffect(() => {
    if (!isMyTurn || !queuedAction) return;
    const action: PlayerAction = queuedAction === "check-fold" && legal.actions.includes("check") ? "check" : "fold";
    if (!legal.actions.includes(action)) return;
    setQueuedAction(null);
    onAct(action);
  }, [game.actorIndex, isMyTurn, legalKey, onAct, queuedAction]);
  if (!actor || game.phase === "complete") return null;
  const can = (action: typeof legal.actions[number]) => isMyTurn && legal.actions.includes(action);
  const progress = Math.max(0, Math.min(1, turnRemainingMs / 25_000));
  const seconds = Math.max(0, Math.ceil(turnRemainingMs / 1000));
  const visiblePot = game.pot + game.seats.reduce((sum, seat) => sum + seat.bet, 0);
  const quickRaises = [["1/3", .33], ["1/2", .5], ["2/3", .67], ["底池", 1]] as const;
  const chipUnit = Math.max(1, game.smallBlind);
  const quickTarget = (ratio: number) => Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round((visiblePot * ratio + game.currentBet) / chipUnit) * chipUnit));
  const commitRaise = () => {
    setRaiseOpen(false);
    if (raiseTo >= legal.maxRaiseTo) onAct("all-in");
    else onAct("raise", raiseTo);
  };

  if (!isMyTurn) return <div className="action-dock waiting-turn">
    <div className="action-waiting"><GameAvatar seed={actor.userId ?? actor.id} label={actor.name} /><span><small>等待行动</small><b>{actor.name}</b></span><i /></div>
    <div className="preaction-buttons"><button className={queuedAction === "check-fold" ? "active" : ""} onClick={() => setQueuedAction(queuedAction === "check-fold" ? null : "check-fold")}>过牌/弃牌</button><button className={queuedAction === "fold" ? "active" : ""} onClick={() => setQueuedAction(queuedAction === "fold" ? null : "fold")}>自动弃牌</button></div>
  </div>;
  return (
    <div className="action-dock my-turn">
      <div className={`turn-progress ${seconds <= 5 ? "urgent" : ""}`}><i style={{ width: `${progress * 100}%` }} /><b>{seconds}</b></div>
      <div className="action-context"><span>{isMyTurn ? "轮到你了" : "等待行动"}</span><b><GameAvatar seed={actor.userId ?? actor.id} label={actor.name} /> {actor.name}</b><small>{isMyTurn ? "请在倒计时结束前行动" : "其他玩家行动中"}</small></div>
      <div className="action-buttons">
        <button className="action fold" disabled={!can("fold")} onClick={() => onAct("fold")}>弃牌<small>FOLD</small></button>
        {can("check") ? <button className="action neutral" onClick={() => onAct("check")}>过牌<small>CHECK</small></button> : <button className="action neutral" disabled={!can("call")} onClick={() => onAct("call")}>跟注 {isMyTurn ? legal.callAmount : ""}<small>CALL</small></button>}
        <button className={`action raise ${raiseOpen ? "selected" : ""}`} disabled={!can("raise")} onClick={() => setRaiseOpen((open) => !open)}>加注<small>BET SIZE</small></button>
        <button className="action allin" disabled={!can("all-in")} onClick={() => onAct("all-in")}>全下<small>ALL IN</small></button>
      </div>
      {raiseOpen && <div className="raise-panel">
        <header><span>加注至</span><b>{raiseTo >= legal.maxRaiseTo ? "ALL IN" : raiseTo.toLocaleString()}</b></header>
        <div className="quick-raises">{quickRaises.map(([label, ratio]) => { const target = quickTarget(ratio); return <button className={quickPreset === label ? "active" : ""} key={label} onClick={() => { setQuickPreset(label); setRaiseTo(target); }}>{label}</button>; })}</div>
        <input aria-label="加注金额" type="range" min={legal.minRaiseTo} max={Math.max(legal.minRaiseTo, legal.maxRaiseTo)} step={chipUnit} value={Math.min(raiseTo, legal.maxRaiseTo)} onChange={(event) => { setQuickPreset(null); setRaiseTo(Number(event.target.value)); }} />
        <button className="raise-confirm" onClick={commitRaise}>{raiseTo >= legal.maxRaiseTo ? "确认全下" : `确认加注 ${raiseTo.toLocaleString()}`}</button>
      </div>}
    </div>
  );
}
