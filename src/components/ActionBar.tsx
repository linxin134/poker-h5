import { useEffect, useState } from "react";
import { legalActions } from "../game/engine";
import type { PlayerAction, PokerState } from "../game/types";

export function ActionBar({ game, mySeatId, onAct }: { game: PokerState; mySeatId: string; onAct(action: PlayerAction, raiseTo?: number): void }) {
  const legal = legalActions(game);
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);
  const actor = game.seats[game.actorIndex];
  const isMyTurn = actor?.id === mySeatId;
  useEffect(() => setRaiseTo(legal.minRaiseTo), [game.actorIndex, legal.minRaiseTo]);
  if (!actor || game.phase === "complete") return null;
  const can = (action: typeof legal.actions[number]) => isMyTurn && legal.actions.includes(action);
  return (
    <div className={`action-dock ${isMyTurn ? "my-turn" : "waiting-turn"}`}>
      <div className="action-context"><span>{isMyTurn ? "轮到你了" : "等待行动"}</span><b>{actor.avatar} {actor.name}</b><small>{isMyTurn ? "请在倒计时结束前行动" : "其他玩家行动中"}</small></div>
      <div className="action-buttons">
        <button className="action fold" disabled={!can("fold")} onClick={() => onAct("fold")}>弃牌<small>FOLD</small></button>
        {can("check") ? <button className="action neutral" onClick={() => onAct("check")}>过牌<small>CHECK</small></button> : <button className="action neutral" disabled={!can("call")} onClick={() => onAct("call")}>跟注 {isMyTurn ? legal.callAmount : ""}<small>CALL</small></button>}
        <div className="raise-box">
          <div className="quick-raises">
            {[.33, .5, .67, 1].map((ratio) => <button disabled={!isMyTurn} key={ratio} onClick={() => setRaiseTo(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round((game.pot * ratio + game.currentBet) / 10) * 10)))}>{ratio === 1 ? "POT" : `${Math.round(ratio * 100)}%`}</button>)}
          </div>
          <input type="range" min={legal.minRaiseTo} max={Math.max(legal.minRaiseTo, legal.maxRaiseTo)} step={10} value={Math.min(raiseTo, legal.maxRaiseTo)} onChange={(event) => setRaiseTo(Number(event.target.value))} disabled={!can("raise")} />
          <button className="action raise" disabled={!can("raise")} onClick={() => onAct("raise", raiseTo)}>加注 {isMyTurn ? raiseTo : ""}<small>RAISE</small></button>
        </div>
        <button className="action allin" disabled={!can("all-in")} onClick={() => onAct("all-in")}>全下<small>ALL IN</small></button>
      </div>
    </div>
  );
}
