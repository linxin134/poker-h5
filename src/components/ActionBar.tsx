import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { legalActions } from "../game/engine";
import type { PlayerAction } from "../game/types";
import type { PublicPokerState } from "../multiplayer/types";

type QueuedAction = { type: "check-fold" } | { type: "call"; amount: number } | null;
type SubmittedAction = { actorSeatId: string; label: string } | null;

type RaisePreset = {
  key: string;
  eyebrow: string;
  label: string;
  detail?: string;
  target: number;
};

function clampRaiseTarget(value: number, min: number, max: number, unit: number) {
  const rounded = Math.round(value / unit) * unit;
  return Math.min(max, Math.max(min, rounded));
}

export function ActionBar({ game, mySeatId, turnRemainingMs, heroPoint, onAct }: { game: PublicPokerState; mySeatId: string; turnRemainingMs: number; heroPoint: { x: number; y: number }; onAct(action: PlayerAction, raiseTo?: number): void }) {
  const legal = legalActions(game);
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [quickPreset, setQuickPreset] = useState<string | null>(null);
  const [queuedAction, setQueuedAction] = useState<QueuedAction>(null);
  const [submittedAction, setSubmittedAction] = useState<SubmittedAction>(null);
  const submittedActorRef = useRef<string | null>(null);
  const actor = game.seats[game.actorIndex];
  const isMyTurn = actor?.id === mySeatId;
  const mySeat = game.seats.find((seat) => seat.id === mySeatId);
  const projectedCall = mySeat ? Math.max(0, Math.min(game.currentBet - mySeat.bet, mySeat.stack)) : 0;
  const legalKey = legal.actions.join(",");
  // The same player can legally act again immediately after a street change.
  // Include the authoritative action history/phase so the optimistic
  // "submitting" state is released even when actorSeatId does not change.
  const actionKey = `${game.handId}:${game.phase}:${game.history.length}:${actor?.id ?? "none"}`;
  const previousActionKey = useRef(actionKey);

  useEffect(() => {
    if (previousActionKey.current === actionKey) return;
    previousActionKey.current = actionKey;
    setRaiseTo(legal.minRaiseTo);
    setRaiseOpen(false);
    setQuickPreset(null);
    setSubmittedAction(null);
    submittedActorRef.current = null;
  }, [actionKey, legal.minRaiseTo]);
  useEffect(() => setQueuedAction(null), [game.handId]);
  useEffect(() => {
    // A queued call is consent for the amount shown at selection time only.
    // Any intervening raise cancels it instead of silently calling more chips.
    if (queuedAction?.type === "call" && queuedAction.amount !== projectedCall) setQueuedAction(null);
  }, [projectedCall, queuedAction]);
  useEffect(() => {
    if (!isMyTurn || !queuedAction || !actor) return;
    let action: PlayerAction;
    if (queuedAction.type === "call") {
      // “跟注”只执行玩家选择时看到的金额，绝不退化成自动让牌。
      if (!legal.actions.includes("call") || legal.callAmount !== queuedAction.amount) {
        setQueuedAction(null);
        return;
      }
      action = "call";
    } else {
      action = legal.actions.includes("check") ? "check" : "fold";
    }
    if (!legal.actions.includes(action)) return;
    setQueuedAction(null);
    submittedActorRef.current = actionKey;
    setSubmittedAction({ actorSeatId: actor.id, label: action === "check" ? "过牌" : action === "call" ? "跟注" : "弃牌" });
    onAct(action);
  }, [actor, game.actorIndex, isMyTurn, legalKey, onAct, queuedAction]);

  if (!actor || game.phase === "complete") return null;

  const can = (action: typeof legal.actions[number]) => isMyTurn && legal.actions.includes(action);
  const seconds = Math.max(0, Math.ceil(turnRemainingMs / 1000));
  const turnProgress = Math.max(0, Math.min(1, turnRemainingMs / 25_000));
  const visiblePot = game.pot + game.seats.reduce((sum, seat) => sum + seat.bet, 0);
  const chipUnit = Math.max(1, game.smallBlind);
  const dockStyle = { "--hero-x": `${heroPoint.x}%`, "--hero-y": `${heroPoint.y}%` } as CSSProperties;
  const countdownStyle = { "--action-progress": turnProgress } as CSSProperties;
  const actionCountdown = () => <i className={`action-countdown-orbit ${seconds <= 5 ? "urgent" : ""}`} style={countdownStyle} aria-hidden="true"><span className="action-countdown-dot" /></i>;

  // Folded and all-in players have finished this hand. Wepoker removes every
  // action/pre-action control and leaves only the avatar status plus cards.
  if (mySeat?.folded || mySeat?.allIn) return null;

  const heroBet = mySeat?.bet ?? 0;
  const quickTarget = (ratio: number) => {
    // Pot-sized raises must include the outstanding call before applying the
    // selected pot fraction. Keep the server-provided legal range authoritative.
    const raiseSize = visiblePot * ratio + (game.currentBet - heroBet);
    return clampRaiseTarget(game.currentBet + raiseSize, legal.minRaiseTo, legal.maxRaiseTo, chipUnit);
  };

  const raisePresets: RaisePreset[] = game.phase === "preflop"
    ? [2, 3, 4, 5, 6].map((blindMultiple) => {
      const target = clampRaiseTarget(game.bigBlind * blindMultiple, legal.minRaiseTo, legal.maxRaiseTo, chipUnit);
      return {
        key: `chips-${target}`,
        eyebrow: "加到",
        label: target.toLocaleString(),
        target,
      };
    })
    : [["1/3", .33], ["1/2", .5], ["2/3", .67], ["1", 1], ["1.2", 1.2]].map(([label, ratio]) => ({
      key: `pot-${label}`,
      eyebrow: "底池",
      label: String(label),
      target: quickTarget(Number(ratio)),
      detail: quickTarget(Number(ratio)).toLocaleString(),
    }));
  const submit = (action: PlayerAction, label: string, target?: number) => {
    // Touch browsers can emit pointerup and a synthetic click for one tap.
    // Guard synchronously so one visible action can never be sent twice.
    if (submittedActorRef.current === actionKey) return;
    submittedActorRef.current = actionKey;
    setRaiseOpen(false);
    setSubmittedAction({ actorSeatId: actor.id, label });
    onAct(action, target);
  };
  const activate = (action: PlayerAction, label: string, target?: number) => ({
    onClick: () => submit(action, label, target),
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "touch") return;
      event.preventDefault();
      submit(action, label, target);
    },
  });
  const commitRaise = () => {
    if (raiseTo >= legal.maxRaiseTo) submit("all-in", "All in");
    else submit("raise", game.currentBet === 0 ? "下注" : "加注", raiseTo);
  };
  const selectedRatio = visiblePot > 0 ? Math.max(0, (raiseTo - game.currentBet) / visiblePot) : 0;
  const raiseProgress = legal.maxRaiseTo <= legal.minRaiseTo ? 1 : (raiseTo - legal.minRaiseTo) / (legal.maxRaiseTo - legal.minRaiseTo);

  if (!isMyTurn) return (
    <div className="action-dock waiting-turn action-orbit" style={dockStyle}>
      <div className="preaction-buttons" aria-label="预操作">
        <button className={queuedAction?.type === "check-fold" ? "active" : ""} aria-pressed={queuedAction?.type === "check-fold"} onClick={() => setQueuedAction(queuedAction?.type === "check-fold" ? null : { type: "check-fold" })}>让或弃</button>
        <button className={queuedAction?.type === "call" ? "active" : ""} aria-pressed={queuedAction?.type === "call"} aria-label={projectedCall > 0 ? `${projectedCall.toLocaleString()} 跟注` : "跟注"} disabled={projectedCall <= 0} onClick={() => setQueuedAction(queuedAction?.type === "call" ? null : { type: "call", amount: projectedCall })}>{projectedCall > 0 ? <><b>{projectedCall.toLocaleString()}</b><span>跟注</span></> : <span>跟注</span>}</button>
      </div>
    </div>
  );

  if (submittedAction?.actorSeatId === actor.id) return (
    <div className="action-dock action-submitting action-orbit" style={dockStyle}><i /><b>{submittedAction.label}</b></div>
  );

  const hasRaise = can("raise");
  const isCallingAllIn = can("call") && legal.callAmount >= actor.stack;
  const rightAction = can("check")
    ? { className: "check", action: "check" as const, label: "让牌", amount: null }
    : isCallingAllIn && can("all-in")
      ? { className: "allin", action: "all-in" as const, label: "All in", amount: null }
      : can("call")
      ? { className: "call", action: "call" as const, label: "跟注", amount: legal.callAmount }
      : can("all-in")
        ? { className: "allin", action: "all-in" as const, label: "All in", amount: null }
        : null;

  return (
    <div className={`action-dock my-turn action-orbit ${raiseOpen ? "raise-adjusting" : ""}`} style={dockStyle} aria-label={`牌局操作，剩余 ${seconds} 秒`}>
      {raiseOpen && <button type="button" className="raise-backdrop" aria-label="关闭加注调节" onClick={() => setRaiseOpen(false)} />}

      {hasRaise && <div className="quick-raises action-arc" aria-label="快捷加注">
        {raisePresets.map((preset) => <button type="button" className={quickPreset === preset.key ? "active" : ""} key={preset.key} onClick={() => { setQuickPreset(preset.key); setRaiseTo(preset.target); }}>
          <small>{preset.eyebrow}</small><b>{preset.label}</b>{preset.detail && <em>{preset.detail}</em>}
        </button>)}
      </div>}

      <div className={`action-buttons ${hasRaise ? "with-raise replaces-avatar" : "without-raise keeps-avatar"}`}>
        <button className="action fold" data-turn-seconds={seconds} disabled={!can("fold")} {...activate("fold", "弃牌")}>{actionCountdown()}<span>弃牌</span></button>
        {hasRaise && <button className={`action raise ${raiseOpen ? "selected" : ""}`} data-turn-seconds={seconds} onPointerDown={(event) => { event.stopPropagation(); setRaiseOpen(true); }}>{actionCountdown()}<span>{game.currentBet === 0 ? "下注" : "加注"}</span></button>}
        {rightAction && <button className={`action ${rightAction.className}`} data-turn-seconds={seconds} {...activate(rightAction.action, rightAction.label)}>{actionCountdown()}{rightAction.amount !== null && <b>{rightAction.amount.toLocaleString()}</b>}<span>{rightAction.label}</span></button>}
      </div>

      {raiseOpen && <div className="raise-panel raise-rail" role="dialog" aria-label="调节加注金额" style={{ "--raise-handle-y": `${190 - Math.max(0, Math.min(1, raiseProgress)) * 156}px` } as CSSProperties}>
        <header><b>{raiseTo.toLocaleString()}</b></header>
        <div className="raise-percent"><b>{Math.round(selectedRatio * 100)}%</b><small>{selectedRatio.toFixed(1)}x底池</small></div>
        <input aria-label="加注金额" type="range" min={legal.minRaiseTo} max={Math.max(legal.minRaiseTo, legal.maxRaiseTo)} step={chipUnit} value={Math.min(raiseTo, legal.maxRaiseTo)} onChange={(event) => { setQuickPreset(null); setRaiseTo(Number(event.target.value)); }} />
        <i className="raise-handle" aria-hidden="true">↑</i>
        <button type="button" className="raise-confirm" onClick={commitRaise}>确定</button>
      </div>}
    </div>
  );
}
