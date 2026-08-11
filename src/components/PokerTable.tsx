import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { User } from "../services/api";
import { useGameStore } from "../store/gameStore";
import { useRoomStore } from "../store/roomStore";
import { ActionBar } from "./ActionBar";
import { EmojiTray } from "./EmojiTray";
import { GameDrawer, type DrawerTab } from "./GameDrawer";
import { PlayingCard } from "./PlayingCard";
import { EffectsLayer } from "../pixi/EffectsLayer";
import { playSound } from "../services/audio";
import { GameAvatar } from "./GameAvatar";
import { UiIcon } from "./UiIcon";
import { anchoredSeatPoint } from "../game/tableLayout";

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
  const disconnect = useRoomStore((state) => state.disconnect);
  const setScreen = useGameStore((state) => state.setScreen);
  const settings = useGameStore((state) => state.settings);
  const receiveEmoji = useGameStore((state) => state.receiveEmoji);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [interactionSeatId, setInteractionSeatId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const activeGame = room?.game;
  useEffect(() => {
    const latest = activeGame?.history.at(-1);
    if (!latest || (activeGame?.history.length ?? 0) === 1) return;
    if (latest.type === "fold") playSound("fold", settings.sound);
    else if (["call", "raise", "all-in"].includes(latest.type)) playSound("chips", settings.sound);
    else if (latest.type === "check") playSound("check", settings.sound);
    else if (latest.type === "street") playSound("street", settings.sound);
    else if (["win", "showdown"].includes(latest.type)) playSound("win", settings.sound);
  }, [activeGame?.handId, activeGame?.history.length, settings.sound]);

  function leaveRoom() {
    disconnect();
    setScreen("lobby");
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
    const relativePosition = (position - anchorPosition + tableCapacity) % tableCapacity;
    return anchoredSeatPoint(relativePosition, tableCapacity);
  }

  function positionStyle(position: number) {
    const point = positionPoint(position);
    return { "--seat-x": `${point.x}%`, "--seat-y": `${point.y}%` } as CSSProperties;
  }

  const effectSeatPositions = Object.fromEntries(game.seats.map((seat) => {
    const point = positionPoint(seat.position ?? 0);
    return [seat.id, { x: point.x / 100, y: point.y / 100 }];
  }));
  const interactionSeat = game.seats.find((seat) => seat.id === interactionSeatId);
  const interactionTargets = game.seats.filter((seat) => seat.id !== room.mySeatId).map((seat) => ({ id: seat.id, name: seat.name }));
  const myRoomSeatId = room.mySeatId;

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1_800);
  }

  function playInteraction(emoji: string, target: string) {
    receiveEmoji(crypto.randomUUID(), emoji, myRoomSeatId, target);
  }

  return <section data-drawer={drawer ?? ""} className={`table-screen fresh-table ${game.phase === "complete" ? "settled" : ""} ${!mySeat ? "spectating" : ""} ${actorSeatId === room.mySeatId ? "my-turn" : "waiting-turn"}`} style={{ "--animation-speed": `${1 / settings.animationSpeed}s` } as CSSProperties}>
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
        <div className="board-cards">
          {Array.from({ length: 5 }, (_, index) => game.board[index]
            ? <PlayingCard key={`${game.handId}-${index}-${game.board[index]}`} card={game.board[index]} delay={index * .08} />
            : <PlayingCard key={`${game.handId}-slot-${index}`} hidden delay={index * .05} />)}
        </div>
        <div className="pot-badge" aria-label={`总底池 ${visiblePot.toLocaleString()}`}><i aria-hidden="true" /><small>总底池</small><span>{visiblePot.toLocaleString()}</span></div>
      </div>

      {displaySeats.filter((seat) => !seat.standing).map((seat) => {
        const isActor = seat.id === actorSeatId;
        const isMe = seat.id === room.mySeatId;
        const cardCount = seat.holeCards.length || seat.holeCardCount || 0;
        return <motion.div role={isMe ? undefined : "button"} tabIndex={isMe ? undefined : 0} aria-label={isMe ? undefined : `与 ${seat.name} 互动`} onClick={() => !isMe && setInteractionSeatId(seat.id)} className={`seat ${isActor ? "active" : ""} ${seat.folded && game.phase !== "complete" ? "folded" : ""} ${isMe ? "hero-seat" : ""} ${seat.connected === false ? "offline" : ""} ${!isMe ? "interactable-seat" : ""}`} style={positionStyle(seat.position ?? 0)} key={seat.id} layout>
          <div className="seat-cards">
            {Array.from({ length: cardCount }, (_, cardIndex) => <PlayingCard small key={`${game.handId}-${cardIndex}`} card={seat.holeCards[cardIndex]} hidden={!seat.holeCards[cardIndex]} delay={cardIndex * .08} />)}
          </div>
          <div className="avatar-ring"><GameAvatar seed={seat.userId ?? seat.id} label={seat.name} />{isActor && <><i className={`timer-ring ${turnRemaining <= 5_000 ? "urgent" : ""}`} style={{ "--turn-progress": Math.max(0, Math.min(1, turnRemaining / 25_000)) } as CSSProperties} /><em className="seat-countdown">{Math.max(0, Math.ceil(turnRemaining / 1000))}</em></>}{seat.connected === false && <em className="offline-dot" />}</div>
          <div className="seat-info"><b>{seat.name}{isMe ? " · 你" : ""}</b><span>{seat.stack.toLocaleString()}</span></div>
          {seat.lastAction && <motion.div className="action-bubble" initial={{ scale: .7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>{seat.lastAction}</motion.div>}
          {seat.bet > 0 && <motion.div className="seat-bet" initial={{ scale: 0 }} animate={{ scale: 1 }}>● {seat.bet}</motion.div>}
          {seat.id === dealerSeatId && <span className="dealer-button">D</span>}
        </motion.div>;
      })}

      {pendingMembers.map((member) => <motion.div className={`seat pending-seat ${member.userId === user?.id ? "hero-seat" : ""}`} style={positionStyle(member.seatIndex!)} key={member.userId} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }}>
        <div className="avatar-ring"><GameAvatar seed={member.userId} label={member.nickname} />{!member.connected && <em className="offline-dot" />}</div>
        <div className="seat-info"><b>{member.nickname}{member.userId === user?.id ? " · 你" : ""}</b><span>下一手加入</span></div>
      </motion.div>)}

      {canChooseLateSeat && Array.from({ length: room.capacity }, (_, position) => !occupiedPositions.has(position) && <motion.button type="button" className="waiting-table-seat empty late-seat-choice" style={positionStyle(position)} onClick={() => send({ type: "sit", seatIndex: position })} key={`late-${position}`} initial={{ opacity: 0, scale: .75 }} animate={{ opacity: 1, scale: 1 }}>
        <span>＋</span><b>空位</b><small>点击落座</small>
      </motion.button>)}

      <AnimatePresence>{interactionSeat && <motion.div className="player-interaction-card" initial={{ opacity: 0, scale: .86, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .9 }}>
        <header><span><GameAvatar seed={interactionSeat.userId ?? interactionSeat.id} label={interactionSeat.name} /></span><div><small>与玩家互动</small><b>{interactionSeat.name}</b></div><button aria-label="关闭玩家互动" onClick={() => setInteractionSeatId(null)}><UiIcon name="close" /></button></header>
        <div>{[["👏", "点赞"], ["🍺", "干杯"], ["🌹", "送花"], ["🍅", "番茄"]].map(([emoji, label]) => <button key={label} onClick={() => { playInteraction(emoji, interactionSeat.id); setInteractionSeatId(null); }}><span>{emoji}</span><small>{label}</small></button>)}</div>
      </motion.div>}</AnimatePresence>

      <div className="table-bottom-tools">
        <button aria-label="计分" onClick={() => setDrawer("stats")}><UiIcon name="stats" /></button>
        <button aria-label="聊天" onClick={() => setDrawer("chat")}><UiIcon name="chat" /></button>
      </div>
      <button className="table-shield" aria-label="牌局由服务端校验" onClick={() => showNotice("牌局操作由服务端校验")}><UiIcon name="shield" /></button>
      <EmojiTray targetSeatId={targetSeatId} targets={interactionTargets} onSend={playInteraction} />
      <EffectsLayer seatPositions={effectSeatPositions} />
      <AnimatePresence>
        {game.phase === "complete" && room.status === "playing" && <motion.div className="winner-banner hand-settlement" initial={{ opacity: 0, scale: .9, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }}>
          <p>HAND {game.handNumber} · POT {(game.result?.pot ?? 0).toLocaleString()}</p>
          <h2>{game.winnerText}</h2>
          <div className="settlement-winners">{winners.map((winner) => <div key={winner.id}><span><GameAvatar seed={winner.userId ?? winner.id} label={winner.name} /> {winner.name}</span><div>{winner.holeCards.map((card, index) => <PlayingCard small card={card} key={`${winner.id}-${card}-${index}`} />)}</div></div>)}</div>
          <div className="settlement-board"><small>{game.board.length ? "最终公共牌" : "翻牌前结束 · 全桌手牌已公开"}</small>{game.board.length > 0 && <div>{game.board.map((card, index) => <PlayingCard small card={card} key={`${card}-${index}`} />)}</div>}</div>
          <div className="next-hand-status"><span>下一手自动发牌</span><b>{Math.max(0, Math.ceil(nextHandRemaining / 1000))}</b></div>
        </motion.div>}
        {room.status === "finished" && <motion.div className="winner-banner room-finished" initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }}>
          <p>ROOM COMPLETE · {room.hands.length} HANDS</p><h2>好友房已结束</h2>
          <div className="finish-ranking">{room.scoreboard.slice(0, 3).map((entry, index) => <div key={entry.seatId}><span>{index + 1}</span><i><GameAvatar seed={entry.seatId} label={entry.nickname} /></i><b>{entry.nickname}</b><strong className={entry.delta >= 0 ? "positive" : "negative"}>{entry.delta >= 0 ? "+" : ""}{entry.delta}</strong></div>)}</div>
          <div className="finish-actions"><button className="secondary-button" onClick={() => setDrawer("history")}>查看战绩</button><button className="primary-button" onClick={leaveRoom}>返回大厅</button></div>
        </motion.div>}
      </AnimatePresence>
    </div>

    {room.status === "playing" && mySeat && <ActionBar game={game} mySeatId={room.mySeatId} turnRemainingMs={turnRemaining} onAct={(action, raiseTo) => send({ type: "action", action, raiseTo })} />}
    {(roomError || notice) && <div className="room-toast">{roomError ?? notice}</div>}
    {drawer && <><div className="drawer-shade" onClick={() => setDrawer(null)} /><GameDrawer key={drawer} initialTab={drawer} room={room} currentUserId={user?.id ?? ""} onClose={() => setDrawer(null)} onLeave={leaveRoom} onDissolve={() => send({ type: "dissolve" })} onStand={() => send({ type: "stand" })} onTopup={(targetStack) => send({ type: "topup", targetStack })} onChat={(text) => send({ type: "chat", text })} /></>}
  </section>;
}

function WaitingRoom({ room, user, connectionStatus, onSit, onStart, onTopup, onLeave }: { room: NonNullable<ReturnType<typeof useRoomStore.getState>["room"]>; user: User | null; connectionStatus: string; onSit(seatIndex: number): void; onStart(): void; onTopup(targetStack: number): void; onLeave(): void }) {
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const receiveEmoji = useGameStore((state) => state.receiveEmoji);
  const isHost = room.hostUserId === user?.id;
  const seatedCount = room.members.filter((member) => member.seatIndex !== null).length;
  const slots = Array.from({ length: room.capacity }, (_, index) => room.members.find((member) => member.seatIndex === index));
  const myPosition = room.members.find((member) => member.userId === user?.id)?.seatIndex ?? 0;
  const emojiTargets = room.members.filter((member) => member.seatIndex !== null && member.userId !== user?.id).map((member) => ({ id: member.seatId, name: member.nickname }));
  const emojiTarget = emojiTargets[0]?.id ?? room.mySeatId ?? "waiting-table";
  const waitingEffectPositions = Object.fromEntries(room.members.flatMap((member) => {
    if (member.seatIndex === null) return [];
    const relativePosition = (member.seatIndex - myPosition + room.capacity) % room.capacity;
    const point = anchoredSeatPoint(relativePosition, room.capacity);
    return [[member.seatId, { x: point.x / 100, y: point.y / 100 }]];
  }));
  return <section className="waiting-room waiting-with-tools">
    <header><button className="icon-button table-menu-trigger" aria-label="牌桌功能" onClick={() => setDrawer("menu")}><UiIcon name="menu" /></button><span className="hand-chip">房间 {room.code} · 等待开始</span><span className={`connection-pill ${connectionStatus}`}>● {connectionStatus === "connected" ? "实时连接" : "正在重连"}</span><div className="waiting-top-tools"><button aria-label="补充记分牌" onClick={() => setDrawer("topup")}><UiIcon name="chips" /></button><button aria-label="牌局回顾" onClick={() => setDrawer("history")}><UiIcon name="history" /></button></div></header>
    <main className="waiting-table-stage">
      <div className="waiting-felt" />
      {slots.map((member, index) => {
        const relativePosition = (index - myPosition + room.capacity) % room.capacity;
        const { x, y } = anchoredSeatPoint(relativePosition, room.capacity);
        const canChoose = !member || member.userId === user?.id;
        return <motion.button disabled={!canChoose} onClick={() => onSit(index)} className={`waiting-table-seat ${member ? "occupied" : "empty"} ${member?.userId === user?.id ? "mine" : ""}`} style={{ "--seat-x": `${x}%`, "--seat-y": `${y}%` } as CSSProperties} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay:index * .04 }} key={member?.userId ?? index}>
          <span>{member ? <GameAvatar seed={member.userId} label={member.nickname} /> : "＋"}{member && <i className={member.connected ? "online" : ""} />}</span>
          <b>{member?.nickname ?? "空位"}</b>
          <small>{member?.isHost ? "房主" : member ? `座位 ${index + 1}` : "等待加入"}</small>
        </motion.button>;
      })}
      <motion.div className="waiting-table-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <span className="waiting-state">{room.mySeatId ? "等待开局" : "请选择空位"}</span><h1>{seatedCount} / {room.capacity} 已入座</h1>
        <div className="room-rules"><span><small>时长</small><b>{room.durationMinutes} 分钟</b></span><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>筹码</small><b>{room.startingStack.toLocaleString()}</b></span></div>
        {isHost ? <button className="primary-button start-room-button" disabled={seatedCount < 3} onClick={onStart}>{seatedCount < 3 ? `还需 ${3 - seatedCount} 人落座` : "开始牌局 →"}</button> : <div className="guest-waiting"><span className="room-loader" /><b>{room.mySeatId ? "等待房主开始" : "请选择一个空位落座"}</b></div>}
      </motion.div>
      <nav className="waiting-bottom-tools" aria-label="牌桌功能栏">
        <button aria-label="计分" onClick={() => setDrawer("stats")}><UiIcon name="stats" /></button>
        <button aria-label="聊天" onClick={() => setDrawer("chat")}><UiIcon name="chat" /></button>
      </nav>
      <EmojiTray targetSeatId={emojiTarget} targets={emojiTargets} onSend={(emoji, target) => receiveEmoji(crypto.randomUUID(), emoji, room.mySeatId || "waiting-self", target)} />
      <EffectsLayer seatPositions={waitingEffectPositions} />
    </main>
    {drawer && <><div className="drawer-shade" onClick={() => setDrawer(null)} /><GameDrawer key={drawer} initialTab={drawer} room={room} currentUserId={user?.id ?? ""} onClose={() => setDrawer(null)} onLeave={onLeave} onDissolve={() => useRoomStore.getState().send({ type: "dissolve" })} onStand={() => useRoomStore.getState().send({ type: "stand" })} onTopup={onTopup} onChat={(text) => useRoomStore.getState().send({ type: "chat", text })} /></>}
  </section>;
}
