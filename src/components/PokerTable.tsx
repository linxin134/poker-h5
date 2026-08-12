import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { User } from "../services/api";
import { useGameStore } from "../store/gameStore";
import { useRoomStore } from "../store/roomStore";
import { ActionBar } from "./ActionBar";
import { EmojiTray } from "./EmojiTray";
import { GameDrawer, type DrawerTab } from "./GameDrawer";
import { PlayingCard } from "./PlayingCard";
import { EffectsLayer } from "../pixi/EffectsLayer";
import { playSound, speakAction } from "../services/audio";
import { GameAvatar } from "./GameAvatar";
import { UiIcon } from "./UiIcon";
import { anchoredSeatPoint, relativeSeatPosition } from "../game/tableLayout";
import { evaluateHand } from "../game/cards";

const phaseLabels = { idle: "等待", preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌", complete: "本手结束" };

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PokerTable({ user }: { user: User | null; onLogin(): void }) {
  const room = useRoomStore((state) => state.room);
  const connectionStatus = useRoomStore((state) => state.connectionStatus);
  const roomError = useRoomStore((state) => state.error);
  const send = useRoomStore((state) => state.send);
  const leave = useRoomStore((state) => state.leave);
  const settings = useGameStore((state) => state.settings);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [interactionSeatId, setInteractionSeatId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const soundedHandRef = useRef<string | null>(null);
  const collectedHandRef = useRef<string | null>(null);
  const countdownRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const activeGame = room?.game;
  useEffect(() => {
    setInteractionSeatId(null);
  }, [activeGame?.handId, activeGame?.history.length, activeGame?.phase, room?.status]);

  useEffect(() => {
    if (!interactionSeatId) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".player-interaction-card,.interactable-avatar")) return;
      setInteractionSeatId(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [interactionSeatId]);
  useEffect(() => {
    const latest = activeGame?.history.at(-1);
    if (!latest || (activeGame?.history.length ?? 0) === 1) return;
    if (latest.type === "fold") { playSound("fold", settings.sound); speakAction("fold", settings.sound); }
    else if (latest.type === "all-in") { playSound("allin", settings.sound); speakAction("all-in", settings.sound); }
    else if (latest.type === "call") { playSound("chips", settings.sound); speakAction("call", settings.sound); }
    else if (latest.type === "raise") { playSound("chips", settings.sound); speakAction("raise", settings.sound); }
    else if (latest.type === "check") playSound("check", settings.sound);
    else if (latest.type === "street") playSound("street", settings.sound);
    else if (["win", "showdown"].includes(latest.type)) playSound("win", settings.sound);
  }, [activeGame?.handId, activeGame?.history.length, settings.sound]);

  useEffect(() => {
    if (!activeGame?.handId || soundedHandRef.current === activeGame.handId) return;
    soundedHandRef.current = activeGame.handId;
    playSound("deal", settings.sound);
  }, [activeGame?.handId, settings.sound]);

  const activeActorSeatId = activeGame?.seats[activeGame.actorIndex]?.id;
  const isOwnTurn = Boolean(activeActorSeatId && activeActorSeatId === room?.mySeatId && activeGame?.phase !== "complete");
  useEffect(() => {
    if (isOwnTurn) playSound("turn", settings.sound);
  }, [activeActorSeatId, activeGame?.handId, isOwnTurn, settings.sound]);

  const soundCountdown = isOwnTurn && room?.turnEndsAt ? Math.max(0, Math.ceil((room.turnEndsAt - now) / 1000)) : 0;
  useEffect(() => {
    if (soundCountdown > 0 && soundCountdown <= 5 && countdownRef.current !== soundCountdown) playSound("countdown", settings.sound);
    countdownRef.current = soundCountdown;
  }, [soundCountdown, settings.sound]);

  useEffect(() => {
    if (!activeGame?.handId || activeGame.phase !== "complete" || !activeGame.result?.pot || collectedHandRef.current === activeGame.handId) return;
    collectedHandRef.current = activeGame.handId;
    const timer = window.setTimeout(() => playSound("collect", settings.sound), 520);
    return () => window.clearTimeout(timer);
  }, [activeGame?.handId, activeGame?.phase, activeGame?.result?.pot, settings.sound]);

  function leaveRoom() {
    leave();
  }

  if (!room) return <section className="room-loading"><span className="room-loader" /><b>{connectionStatus === "error" ? "连接失败" : "正在进入好友房"}</b><p>{roomError ?? "正在建立实时连接…"}</p><button className="ghost-button" onClick={leaveRoom}>返回大厅</button></section>;
  if (room.status === "waiting" || !room.game) return <WaitingRoom room={room} user={user} connectionStatus={connectionStatus} onSit={(seatIndex) => send({ type: "sit", seatIndex })} onStart={() => send({ type: "start" })} onTopup={(targetStack) => send({ type: "topup", targetStack })} onLeave={leaveRoom} />;

  const game = room.game;
  const visiblePot = game.phase === "complete" ? (game.result?.pot ?? 0) : game.pot + game.seats.reduce((sum, seat) => sum + seat.bet, 0);
  const roomRemaining = room.endsAt ? room.endsAt - now : 0;
  const nextHandRemaining = room.nextHandAt ? room.nextHandAt - now : 0;
  const turnRemaining = room.turnEndsAt ? room.turnEndsAt - now : 0;
  const targetSeatId = game.seats.find((seat) => seat.id !== room.mySeatId && !seat.folded)?.id ?? game.seats.find((seat) => seat.id !== room.mySeatId)?.id ?? room.mySeatId;
  const winners = game.seats.filter((seat) => game.result?.winnerSeatIds.includes(seat.id));
  const myMember = room.members.find((member) => member.userId === user?.id);
  const mySeat = game.seats.find((seat) => seat.id === room.mySeatId && !seat.standing);
  // Every client owns its perspective: rotate the local player's physical
  // seat to relative position zero, the safe bottom position.
  const anchorPosition = mySeat?.position ?? myMember?.seatIndex ?? game.seats[0]?.position ?? 0;
  const actorSeatId = game.seats[game.actorIndex]?.id;
  const dealerSeatId = game.seats[game.dealerIndex]?.id;
  const displaySeats = [...game.seats].sort((a, b) => (((a.position ?? 0) - anchorPosition + room.capacity) % room.capacity) - (((b.position ?? 0) - anchorPosition + room.capacity) % room.capacity));
  const participatingUserIds = new Set(game.seats.map((seat) => seat.userId));
  const pendingMembers = room.members.filter((member) => member.seatIndex !== null && !participatingUserIds.has(member.userId));
  const occupiedPositions = new Set(room.members.flatMap((member) => member.seatIndex === null ? [] : [member.seatIndex]));
  const canChooseLateSeat = myMember?.seatIndex === null;
  const tableCapacity = room.capacity;

  function positionPoint(position: number) {
    const relativePosition = relativeSeatPosition(position, anchorPosition, tableCapacity);
    return anchoredSeatPoint(relativePosition, tableCapacity);
  }

  const winnerTargets = winners.map((winner) => ({ id: winner.id, ...positionPoint(winner.position ?? 0) }));

  function positionStyle(position: number) {
    const point = positionPoint(position);
    return { "--seat-x": `${point.x}%`, "--seat-y": `${point.y}%` } as CSSProperties;
  }

  const effectSeatPositions = Object.fromEntries(game.seats.map((seat) => {
    const point = positionPoint(seat.position ?? 0);
    return [seat.id, { x: point.x / 100, y: point.y / 100 }];
  }));
  const interactionSeat = game.seats.find((seat) => seat.id === interactionSeatId);
  const interactionPoint = interactionSeat ? positionPoint(interactionSeat.position ?? 0) : null;
  const interactionTargets = game.seats.filter((seat) => seat.id !== room.mySeatId).map((seat) => ({ id: seat.id, name: seat.name }));
  const myRoomSeatId = room.mySeatId;
  const latestAllInAction = [...game.history].reverse().find((record) => record.type === "all-in" && now - record.at < 1_600);
  const latestAllInSeat = latestAllInAction?.seatId
    ? game.seats.find((seat) => seat.id === latestAllInAction.seatId)
    : null;

  function handNameForSeat(seat: (typeof game.seats)[number]) {
    if (seat.holeCards.length < 2) return null;
    const availableCards = [...seat.holeCards, ...game.board];
    if (availableCards.length >= 5) return evaluateHand(availableCards).name;
    return seat.holeCards[0][0] === seat.holeCards[1][0] ? "一对" : "高牌";
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1_800);
  }

  function playInteraction(emoji: string, target: string) {
    if (!myRoomSeatId || target === myRoomSeatId) return;
    send({ type: "emoji", emoji, targetSeatId: target });
  }

  return <section data-drawer={drawer ?? ""} data-hand-id={game.handId} data-phase={game.phase} data-result={game.result?.reason ?? ""} className={`table-screen fresh-table ${game.phase === "complete" ? "settled" : ""} ${!mySeat ? "spectating" : ""} ${actorSeatId === room.mySeatId ? "my-turn" : "waiting-turn"}`} style={{ "--animation-speed": `${1 / settings.animationSpeed}s` } as CSSProperties}>
    <header className="table-topbar wpk-table-bar">
      <div className="table-left"><button className="icon-button table-menu-trigger" aria-label="牌桌功能" onClick={() => setDrawer("menu")}><UiIcon name="menu" /></button><span className="hand-chip">第 {game.handNumber} 手 · {phaseLabels[game.phase]}</span></div>
      <div className="table-status-hud">
        <span><small>底池</small><b>{visiblePot.toLocaleString()}</b></span>
        <i />
        <span className={roomRemaining <= 0 ? "expired" : ""}><small>{roomRemaining <= 0 ? "本手后结束" : "房间剩余"}</small><b>{formatClock(roomRemaining)}</b></span>
      </div>
      <div className="table-tools">
        <button aria-label="补充记分牌" onClick={() => setDrawer("topup")}><UiIcon name="chips" /></button>
        <button aria-label="牌局回顾" onClick={() => setDrawer("history")}><UiIcon name="history" /></button>
      </div>
    </header>

    <div className="table-stage">
      <div className="fresh-felt" />
      <div className="board-zone">
        <div className={`board-room-countdown ${roomRemaining <= 0 ? "expired" : ""}`}>{roomRemaining <= 0 ? "本手后结束" : formatClock(roomRemaining)}</div>
        <div className={`board-cards ${game.board.length === 0 ? "empty" : ""}`}>
          {game.board.map((card, index) => <PlayingCard key={`${game.handId}-${index}-${card}`} card={card} delay={index * .08} />)}
        </div>
        <div className="pot-badge" aria-label={`总底池 ${visiblePot.toLocaleString()}`}><i aria-hidden="true" /><small>总底池</small><span>{visiblePot.toLocaleString()}</span></div>
      </div>

      {displaySeats.filter((seat) => !seat.standing).map((seat) => {
        const isActor = seat.id === actorSeatId;
        const isMe = seat.id === room.mySeatId;
        const seatPoint = positionPoint(seat.position ?? 0);
        const sideClass = seatPoint.x > 50 ? "seat-right" : seatPoint.x < 50 ? "seat-left" : "seat-center";
        const rowClass = seatPoint.y >= 64 ? "seat-lower" : seatPoint.y <= 25 ? "seat-upper" : "seat-middle";
        const displayHoleCards = seat.holeCards.length ? seat.holeCards : (seat.shownHoleCards ?? []);
        const cardCount = Math.max(displayHoleCards.length, seat.holeCardCount || 0);
        const showHandName = displayHoleCards.length >= 2 && (isMe || game.phase === "showdown" || game.phase === "complete");
        const actionText = seat.lastAction?.startsWith("过牌") ? "让牌"
          : seat.lastAction?.startsWith("跟注") ? "跟注"
          : seat.lastAction?.startsWith("加注") ? "下注"
          : seat.lastAction?.startsWith("弃牌") ? "弃牌"
          : null;
        const actionClass = actionText === "让牌" ? "check" : actionText === "跟注" ? "call" : actionText === "下注" ? "bet" : actionText === "弃牌" ? "fold" : "";
        return <motion.div data-seat-id={seat.id} className={`seat ${sideClass} ${rowClass} ${isActor ? "active" : ""} ${seat.folded ? "folded" : ""} ${seat.allIn ? "all-in-seat" : ""} ${winners.some((winner) => winner.id === seat.id) ? "winner-seat" : ""} ${isMe ? "hero-seat" : "opponent-seat"} ${seat.connected === false ? "offline" : ""} ${!isMe ? "interactable-seat" : ""}`} style={positionStyle(seat.position ?? 0)} key={seat.id}>
          <b className="seat-name">{seat.name}{isMe ? " · 你" : ""}</b>
          {isMe
            ? <div className="avatar-ring"><GameAvatar seed={seat.avatar || seat.userId || seat.id} label={seat.name} />{isActor && <><i className={`timer-ring ${turnRemaining <= 5_000 ? "urgent" : ""}`} style={{ "--turn-progress": Math.max(0, Math.min(1, turnRemaining / 25_000)) } as CSSProperties} /><em className="seat-countdown">{Math.max(0, Math.ceil(turnRemaining / 1000))}</em></>}{seat.allIn && game.phase !== "complete" && <motion.i className="all-in-status" initial={{ opacity:0, scale:.75 }} animate={{ opacity:1, scale:1 }}>All in</motion.i>}</div>
            : <button type="button" className="avatar-ring interactable-avatar" aria-label={`与 ${seat.name} 互动`} onClick={() => setInteractionSeatId(seat.id)}><GameAvatar seed={seat.avatar || seat.userId || seat.id} label={seat.name} />{isActor && <><i className={`timer-ring ${turnRemaining <= 5_000 ? "urgent" : ""}`} style={{ "--turn-progress": Math.max(0, Math.min(1, turnRemaining / 25_000)) } as CSSProperties} /><em className="seat-countdown">{Math.max(0, Math.ceil(turnRemaining / 1000))}</em></>}{seat.allIn && game.phase !== "complete" && <motion.i className="all-in-status" initial={{ opacity:0, scale:.75 }} animate={{ opacity:1, scale:1 }}>All in</motion.i>}</button>}
          <div className="seat-cards">
            {Array.from({ length: cardCount }, (_, cardIndex) => {
              const card = displayHoleCards[cardIndex] ?? undefined;
              const canReveal = isMe && seat.folded && Boolean(card) && !(seat.revealedHoleCardIndexes ?? []).includes(cardIndex);
              const renderedCard = <PlayingCard small key={`${game.handId}-${cardIndex}-${card ?? "back"}`} card={card} hidden={!card} delay={cardIndex * .08} />;
              return canReveal ? <button className="reveal-hole-card" aria-label={`公开第 ${cardIndex + 1} 张底牌`} key={`${game.handId}-reveal-${cardIndex}`} onClick={(event) => { event.stopPropagation(); send({ type:"revealCard", cardIndex }); }}>{renderedCard}<em>点击公开</em></button> : renderedCard;
            })}
          </div>
          {showHandName && handNameForSeat(seat) && <small className="seat-hand-rank">{handNameForSeat(seat)}</small>}
          <span className="seat-stack">{seat.stack.toLocaleString()}</span>
          {!seat.allIn && actionText && <motion.div className={`action-bubble action-${actionClass}`} initial={{ scale: .7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>{actionText}</motion.div>}
          {game.phase !== "complete" && (seat.bet > 0 || (seat.allIn && seat.allInAmount)) && <motion.div className="seat-bet" initial={{ scale: 0 }} animate={{ scale: 1 }}><i aria-hidden="true" />{(seat.bet || seat.allInAmount || 0).toLocaleString()}</motion.div>}
          {seat.id === dealerSeatId && <span className="dealer-button">D</span>}
        </motion.div>;
      })}

      {pendingMembers.map((member) => {
        const point = positionPoint(member.seatIndex!);
        const sideClass = point.x > 50 ? "seat-right" : point.x < 50 ? "seat-left" : "seat-center";
        const rowClass = point.y >= 64 ? "seat-lower" : point.y <= 25 ? "seat-upper" : "seat-middle";
        return <motion.div className={`seat pending-seat ${sideClass} ${rowClass} ${member.userId === user?.id ? "hero-seat" : ""}`} style={positionStyle(member.seatIndex!)} key={member.userId} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }}>
          <b className="seat-name">{member.nickname}{member.userId === user?.id ? " · 你" : ""}</b>
          <div className="avatar-ring"><GameAvatar seed={member.avatar || member.userId} label={member.nickname} /></div>
          <span className="seat-stack">下一手加入</span>
        </motion.div>;
      })}

      {canChooseLateSeat && Array.from({ length: room.capacity }, (_, position) => !occupiedPositions.has(position) && <motion.button type="button" className="waiting-table-seat empty late-seat-choice" style={positionStyle(position)} onClick={() => send({ type: "sit", seatIndex: position })} key={`late-${position}`} initial={{ opacity: 0, scale: .75 }} animate={{ opacity: 1, scale: 1 }}>
        <span>＋</span><b>空位</b><small>点击落座</small>
      </motion.button>)}

      <AnimatePresence>{interactionSeat && interactionPoint && <motion.div data-target-seat-id={interactionSeat.id} className={`player-interaction-card ${interactionPoint.y <= 60 ? "interaction-above" : "interaction-below"} ${interactionPoint.x >= 66 ? "interaction-target-right" : interactionPoint.x <= 34 ? "interaction-target-left" : "interaction-target-center"}`} style={{ "--interaction-x": `${interactionPoint.x}%`, "--interaction-y": `${interactionPoint.y}%` } as CSSProperties} initial={{ opacity: 0, scale: .86 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }}>
        <header><span><GameAvatar seed={interactionSeat.avatar || interactionSeat.userId || interactionSeat.id} label={interactionSeat.name} /></span><div><small>与玩家互动</small><b>{interactionSeat.name}</b></div><button aria-label="关闭玩家互动" onClick={() => setInteractionSeatId(null)}><UiIcon name="close" /></button></header>
        <div>{[["👏", "点赞"], ["🍺", "干杯"], ["🌹", "送花"], ["🍅", "番茄"]].map(([emoji, label]) => <button key={label} onClick={() => { playSound("emoji", settings.sound); playInteraction(emoji, interactionSeat.id); setInteractionSeatId(null); }}><span>{emoji}</span><small>{label}</small></button>)}</div>
      </motion.div>}</AnimatePresence>

      <div className="table-bottom-tools">
        <button aria-label="计分" onClick={() => setDrawer("stats")}><UiIcon name="stats" /></button>
        <button aria-label="聊天" onClick={() => setDrawer("chat")}><UiIcon name="chat" /></button>
      </div>
      <button className="table-shield" aria-label="牌局由服务端校验" onClick={() => showNotice("牌局操作由服务端校验")}><UiIcon name="shield" /></button>
      <EmojiTray targetSeatId={targetSeatId} targets={interactionTargets} onSend={playInteraction} />
      <EffectsLayer seatPositions={effectSeatPositions} />
      {latestAllInSeat && latestAllInAction && <ChipCommitEffect actionId={latestAllInAction.id} amount={latestAllInAction.amount ?? latestAllInSeat.totalContribution} from={positionPoint(latestAllInSeat.position ?? 0)} />}
      {game.phase === "complete" && winnerTargets.length > 0 && <PotAwardEffect handId={game.handId} pot={game.result?.pot ?? 0} targets={winnerTargets} />}
      <AnimatePresence>
        {game.phase === "complete" && game.result?.reason === "showdown" && game.result.winnerSeatIds.includes(room.mySeatId) && <motion.strong key="showdown-win" className="showdown-win-label" initial={{ opacity:0, scale:.5, y:10 }} animate={{ opacity:[0,1,1,0], scale:[.5,1.08,1,1], y:[10,0,0,-6] }} transition={{ duration:3.4, times:[0,.12,.82,1] }}>YOU WIN!</motion.strong>}
        {game.phase === "complete" && room.status === "playing" && <motion.div key="hand-settlement" className="showdown-summary hand-settlement" initial={{ opacity: 0, scale: .92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} transition={{ delay:1.55, duration:.28 }}>
          <span><i aria-hidden="true" />{(game.result?.pot ?? 0).toLocaleString()}</span>
          <b>{game.winnerText}</b>
          <small>{Math.max(0, Math.ceil(nextHandRemaining / 1000))} 秒后下一手</small>
        </motion.div>}
        {room.status === "finished" && <motion.div key="room-finished" className="winner-banner room-finished" initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }}>
          <p>ROOM COMPLETE · {room.hands.length} HANDS</p><h2>好友房已结束</h2>
          <div className="finish-ranking">{room.scoreboard.map((entry, index) => <div key={entry.seatId}><span>{index + 1}</span><i><GameAvatar seed={entry.avatar || entry.seatId} label={entry.nickname} /></i><b>{entry.nickname}</b><small>最终 {entry.stack.toLocaleString()}</small><strong className={entry.delta > 0 ? "positive" : entry.delta < 0 ? "negative" : "zero"}>{entry.delta > 0 ? "+" : ""}{entry.delta}</strong></div>)}</div>
          <div className="finish-actions"><button className="secondary-button" onClick={() => setDrawer("history")}>查看战绩</button><button className="primary-button" onClick={leaveRoom}>返回大厅</button></div>
        </motion.div>}
      </AnimatePresence>
      {room.status === "playing" && mySeat && <ActionBar game={game} mySeatId={room.mySeatId} heroPoint={positionPoint(mySeat.position ?? 0)} turnRemainingMs={turnRemaining} onAct={(action, raiseTo) => send({ type: "action", action, raiseTo })} />}
    </div>
    {(roomError || notice) && <div className="room-toast">{roomError ?? notice}</div>}
    {drawer && <><div className="drawer-shade" onClick={() => setDrawer(null)} /><GameDrawer key={drawer} initialTab={drawer} room={room} currentUserId={user?.id ?? ""} onClose={() => setDrawer(null)} onLeave={leaveRoom} onDissolve={() => send({ type: "dissolve" })} onStand={() => send({ type: "stand" })} onTopup={(targetStack) => send({ type: "topup", targetStack })} onChat={(text) => send({ type: "chat", text })} /></>}
  </section>;
}

function ChipCommitEffect({ actionId, amount, from }: { actionId: string; amount: number; from: { x: number; y: number } }) {
  return <div className="chip-commit-layer" aria-hidden="true" data-all-in-action={actionId}>
    {Array.from({ length:7 }, (_, index) => <motion.i
      key={`${actionId}-${index}`}
      initial={{ left:`${from.x}%`, top:`${from.y}%`, opacity:0, scale:.45 }}
      animate={{ left:"50%", top:"53%", opacity:[0,1,1,0], scale:[.45,1,.85,.4] }}
      transition={{ duration:.68, delay:index * .045, ease:[.2,.72,.25,1] }}
    />)}
    <motion.b initial={{ left:`${from.x}%`, top:`${from.y}%`, opacity:0 }} animate={{ left:"50%", top:"53%", opacity:[0,1,1,0] }} transition={{ duration:.75, delay:.12 }}>{amount.toLocaleString()}</motion.b>
  </div>;
}

function PotAwardEffect({ handId, pot, targets }: { handId: string; pot: number; targets: Array<{ id: string; x: number; y: number }> }) {
  return <div className="pot-award-layer" aria-hidden="true">
    {targets.flatMap((target, winnerIndex) => Array.from({ length: 9 }, (_, coinIndex) => <motion.i
      className="pot-award-coin"
      key={`${handId}-${target.id}-${coinIndex}`}
      initial={{ left:"50%", top:"53%", opacity:0, scale:.35 }}
      animate={{ left:`${target.x}%`, top:`${target.y}%`, opacity:[0,1,1,0], scale:[.35,1,.85,.2] }}
      transition={{ duration:.9, delay:.55 + winnerIndex * .08 + coinIndex * .045, ease:[.2,.72,.25,1] }}
    />))}
    {targets.map((target, index) => <motion.span
      className="pot-winner-burst"
      style={{ left:`${target.x}%`, top:`${target.y}%` }}
      key={`${handId}-${target.id}-burst`}
      initial={{ opacity:0, scale:.4 }}
      animate={{ opacity:[0,1,0], scale:[.4,1.22,1.5] }}
      transition={{ duration:.72, delay:1.38 + index * .08, ease:"easeOut" }}
    ><b>+{Math.max(1, Math.floor(pot / targets.length)).toLocaleString()}</b></motion.span>)}
  </div>;
}

function WaitingRoom({ room, user, connectionStatus, onSit, onStart, onTopup, onLeave }: { room: NonNullable<ReturnType<typeof useRoomStore.getState>["room"]>; user: User | null; connectionStatus: string; onSit(seatIndex: number): void; onStart(): void; onTopup(targetStack: number): void; onLeave(): void }) {
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const isHost = room.hostUserId === user?.id;
  const seatedCount = room.members.filter((member) => member.seatIndex !== null).length;
  const slots = Array.from({ length: room.capacity }, (_, index) => room.members.find((member) => member.seatIndex === index));
  const emojiTargets = room.members.filter((member) => member.seatIndex !== null && member.userId !== user?.id).map((member) => ({ id: member.seatId, name: member.nickname }));
  const emojiTarget = emojiTargets[0]?.id ?? room.mySeatId ?? "waiting-table";
  const myPosition = room.members.find((member) => member.userId === user?.id)?.seatIndex ?? 0;
  const waitingPoint = (position: number) => anchoredSeatPoint(relativeSeatPosition(position, myPosition, room.capacity), room.capacity);
  const waitingEffectPositions = Object.fromEntries(room.members.flatMap((member) => {
    if (member.seatIndex === null) return [];
    const point = waitingPoint(member.seatIndex);
    return [[member.seatId, { x: point.x / 100, y: point.y / 100 }]];
  }));
  return <section className="waiting-room waiting-with-tools">
    <header><button className="icon-button table-menu-trigger" aria-label="牌桌功能" onClick={() => setDrawer("menu")}><UiIcon name="menu" /></button><span className="hand-chip">房间 {room.code} · 等待开始</span><span className={`connection-pill ${connectionStatus}`}>● {connectionStatus === "connected" ? "实时连接" : "正在重连"}</span><div className="waiting-top-tools"><button aria-label="补充记分牌" onClick={() => setDrawer("topup")}><UiIcon name="chips" /></button><button aria-label="牌局回顾" onClick={() => setDrawer("history")}><UiIcon name="history" /></button></div></header>
    <main className="waiting-table-stage">
      <div className="waiting-felt" />
      {slots.map((member, index) => {
        const { x, y } = waitingPoint(index);
        const canChoose = !member || member.userId === user?.id;
        return <motion.button disabled={!canChoose} onClick={() => onSit(index)} className={`waiting-table-seat ${member ? "occupied" : "empty"} ${member?.userId === user?.id ? "mine" : ""}`} style={{ "--seat-x": `${x}%`, "--seat-y": `${y}%` } as CSSProperties} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay:index * .04 }} key={member?.userId ?? index}>
          <span>{member ? <GameAvatar seed={member.avatar || member.userId} label={member.nickname} /> : "＋"}{member && <i className={member.connected ? "online" : ""} />}</span>
          <b>{member?.nickname ?? "空位"}</b>
          <small>{member?.isHost ? "房主" : member ? `座位 ${index + 1}` : "等待加入"}</small>
        </motion.button>;
      })}
      <motion.div className="waiting-table-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <span className="waiting-state">{room.mySeatId ? "等待开局" : "请选择空位"}</span><h1>{seatedCount} / {room.capacity} 已入座</h1>
        <div className="room-rules"><span><small>时长</small><b>{room.durationMinutes} 分钟</b></span><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>筹码</small><b>{room.startingStack.toLocaleString()}</b></span></div>
        {isHost ? <button className="primary-button start-room-button" disabled={seatedCount < 2} onClick={onStart}>{seatedCount < 2 ? `还需 ${2 - seatedCount} 人落座` : "开始牌局 →"}</button> : <div className="guest-waiting"><span className="room-loader" /><b>{room.mySeatId ? "等待房主开始" : "请选择一个空位落座"}</b></div>}
      </motion.div>
      <nav className="waiting-bottom-tools" aria-label="牌桌功能栏">
        <button aria-label="计分" onClick={() => setDrawer("stats")}><UiIcon name="stats" /></button>
        <button aria-label="聊天" onClick={() => setDrawer("chat")}><UiIcon name="chat" /></button>
      </nav>
      <EmojiTray targetSeatId={emojiTarget} targets={emojiTargets} onSend={(emoji, target) => useRoomStore.getState().send({ type: "emoji", emoji, targetSeatId: target })} />
      <EffectsLayer seatPositions={waitingEffectPositions} />
    </main>
    {drawer && <><div className="drawer-shade" onClick={() => setDrawer(null)} /><GameDrawer key={drawer} initialTab={drawer} room={room} currentUserId={user?.id ?? ""} onClose={() => setDrawer(null)} onLeave={onLeave} onDissolve={() => useRoomStore.getState().send({ type: "dissolve" })} onStand={() => useRoomStore.getState().send({ type: "stand" })} onTopup={onTopup} onChat={(text) => useRoomStore.getState().send({ type: "chat", text })} /></>}
  </section>;
}
