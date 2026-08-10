import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { User } from "../services/api";
import { useGameStore } from "../store/gameStore";
import { useRoomStore } from "../store/roomStore";
import { ActionBar } from "./ActionBar";
import { EmojiTray } from "./EmojiTray";
import { GameDrawer } from "./GameDrawer";
import { PlayingCard } from "./PlayingCard";
import { EffectsLayer } from "../pixi/EffectsLayer";
import { playSound } from "../services/audio";

type DrawerTab = "settings" | "history" | "guide" | "stats";
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
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
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
  if (room.status === "waiting" || !room.game) return <WaitingRoom room={room} user={user} connectionStatus={connectionStatus} onSit={(seatIndex) => send({ type: "sit", seatIndex })} onStart={() => send({ type: "start" })} onLeave={leaveRoom} />;

  const game = room.game;
  const visiblePot = game.phase === "complete" ? (game.result?.pot ?? 0) : game.pot + game.seats.reduce((sum, seat) => sum + seat.bet, 0);
  const roomRemaining = room.endsAt ? room.endsAt - now : 0;
  const nextHandRemaining = room.nextHandAt ? room.nextHandAt - now : 0;
  const turnRemaining = room.turnEndsAt ? room.turnEndsAt - now : 0;
  const targetSeatId = game.seats.find((seat) => seat.id !== room.mySeatId && !seat.folded)?.id ?? game.seats.find((seat) => seat.id !== room.mySeatId)?.id ?? room.mySeatId;
  const winners = game.seats.filter((seat) => game.result?.winnerSeatIds.includes(seat.id));
  const myMember = room.members.find((member) => member.userId === user?.id);
  const mySeat = game.seats.find((seat) => seat.id === room.mySeatId);
  const anchorPosition = mySeat?.position ?? myMember?.seatIndex ?? game.seats[0]?.position ?? 0;
  const actorSeatId = game.seats[game.actorIndex]?.id;
  const dealerSeatId = game.seats[game.dealerIndex]?.id;
  const displaySeats = [...game.seats].sort((a, b) => (((a.position ?? 0) - anchorPosition + room.capacity) % room.capacity) - (((b.position ?? 0) - anchorPosition + room.capacity) % room.capacity));
  const participatingUserIds = new Set(game.seats.map((seat) => seat.userId));
  const pendingMembers = room.members.filter((member) => member.seatIndex !== null && !participatingUserIds.has(member.userId));
  const occupiedPositions = new Set(room.members.flatMap((member) => member.seatIndex === null ? [] : [member.seatIndex]));
  const canChooseLateSeat = myMember?.seatIndex === null;
  const tableCapacity = room.capacity;

  function positionStyle(position: number) {
    const relativePosition = (position - anchorPosition + tableCapacity) % tableCapacity;
    const angle = (Math.PI / 180) * (90 + relativePosition * 360 / tableCapacity);
    return {
      "--seat-x": `${50 + Math.cos(angle) * (tableCapacity > 6 ? 44 : 42)}%`,
      "--seat-y": `${49 + Math.sin(angle) * (tableCapacity > 6 ? 41 : 39)}%`
    } as CSSProperties;
  }

  return <section className={`table-screen fresh-table ${game.phase === "complete" ? "settled" : ""} ${!mySeat ? "spectating" : ""}`} style={{ "--animation-speed": `${1 / settings.animationSpeed}s` } as CSSProperties}>
    <header className="table-topbar">
      <div className="table-left"><button className="icon-button" onClick={leaveRoom}>‹</button><span className="brand compact"><i>♠</i>给我擦皮鞋</span><span className="hand-chip">{room.code} · 第 {game.handNumber} 手 · {phaseLabels[game.phase]}</span></div>
      <div className="table-status-hud">
        <span><small>底池</small><b>{visiblePot.toLocaleString()}</b></span>
        <i />
        <span className={roomRemaining <= 0 ? "expired" : ""}><small>{roomRemaining <= 0 ? "本手后结束" : "房间剩余"}</small><b>{formatClock(roomRemaining)}</b></span>
      </div>
      <div className="table-tools">
        <button onClick={() => setDrawer("guide")}><span>?</span><small>玩法</small></button>
        <button onClick={() => setDrawer("history")}><span>▤</span><small>战绩</small></button>
        <button onClick={() => setDrawer("stats")}><span>↗</span><small>积分</small></button>
        <button onClick={() => setDrawer("settings")}><span>⚙</span><small>设置</small></button>
        <button className="user-tool"><span>{user?.avatar ?? "○"}</span><small>{user?.nickname ?? "玩家"}</small></button>
      </div>
    </header>

    <div className="table-stage">
      <div className="fresh-felt" />
      <div className="board-zone">
        <div className="board-cards">
          {Array.from({ length: 5 }, (_, index) => game.board[index]
            ? <PlayingCard key={`${game.handId}-${index}`} card={game.board[index]} delay={index * .08} />
            : <div className="card-slot" key={index} />)}
        </div>
        <div className="pot-badge"><i>●</i><span>{visiblePot.toLocaleString()}</span></div>
      </div>

      {displaySeats.map((seat) => {
        const isActor = seat.id === actorSeatId;
        const isMe = seat.id === room.mySeatId;
        const cardCount = seat.holeCards.length || seat.holeCardCount || 0;
        return <motion.div className={`seat ${isActor ? "active" : ""} ${seat.folded && game.phase !== "complete" ? "folded" : ""} ${isMe ? "hero-seat" : ""} ${seat.connected === false ? "offline" : ""}`} style={positionStyle(seat.position ?? 0)} key={seat.id} layout>
          <div className="seat-cards">
            {Array.from({ length: cardCount }, (_, cardIndex) => <PlayingCard small key={`${game.handId}-${cardIndex}`} card={seat.holeCards[cardIndex]} hidden={!seat.holeCards[cardIndex]} delay={cardIndex * .08} />)}
          </div>
          <div className="avatar-ring"><span>{seat.avatar}</span>{isActor && <i className="timer-ring" style={{ animationDuration: `${Math.max(.5, turnRemaining / 1000)}s` }} />}{seat.connected === false && <em className="offline-dot" />}</div>
          <div className="seat-info"><b>{seat.name}{isMe ? " · 你" : ""}</b><span>{seat.stack.toLocaleString()}</span></div>
          {seat.lastAction && <motion.div className="action-bubble" initial={{ scale: .7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>{seat.lastAction}</motion.div>}
          {seat.bet > 0 && <motion.div className="seat-bet" initial={{ scale: 0 }} animate={{ scale: 1 }}>● {seat.bet}</motion.div>}
          {seat.id === dealerSeatId && <span className="dealer-button">D</span>}
        </motion.div>;
      })}

      {pendingMembers.map((member) => <motion.div className={`seat pending-seat ${member.userId === user?.id ? "hero-seat" : ""}`} style={positionStyle(member.seatIndex!)} key={member.userId} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }}>
        <div className="avatar-ring"><span>{member.avatar}</span>{!member.connected && <em className="offline-dot" />}</div>
        <div className="seat-info"><b>{member.nickname}{member.userId === user?.id ? " · 你" : ""}</b><span>下一手加入</span></div>
      </motion.div>)}

      {canChooseLateSeat && Array.from({ length: room.capacity }, (_, position) => !occupiedPositions.has(position) && <motion.button type="button" className="waiting-table-seat empty late-seat-choice" style={positionStyle(position)} onClick={() => send({ type: "sit", seatIndex: position })} key={`late-${position}`} initial={{ opacity: 0, scale: .75 }} animate={{ opacity: 1, scale: 1 }}>
        <span>＋</span><b>空位</b><small>点击落座</small>
      </motion.button>)}

      {!mySeat && <div className={`late-join-note ${canChooseLateSeat ? "choosing" : "ready"}`}><i />{canChooseLateSeat ? "选择一个空位，下一手参与" : "已落座，下一手自动参与"}</div>}

      <EmojiTray targetSeatId={targetSeatId} onSend={(emoji, target) => send({ type: "emoji", emoji, targetSeatId: target })} />
      <EffectsLayer />
      <AnimatePresence>
        {game.phase === "complete" && room.status === "playing" && <motion.div className="winner-banner hand-settlement" initial={{ opacity: 0, scale: .9, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }}>
          <p>HAND {game.handNumber} · POT {(game.result?.pot ?? 0).toLocaleString()}</p>
          <h2>{game.winnerText}</h2>
          <div className="settlement-winners">{winners.map((winner) => <div key={winner.id}><span>{winner.avatar} {winner.name}</span><div>{winner.holeCards.map((card, index) => <PlayingCard small card={card} key={`${winner.id}-${card}-${index}`} />)}</div></div>)}</div>
          <div className="settlement-board"><small>{game.board.length ? "最终公共牌" : "翻牌前结束 · 全桌手牌已公开"}</small>{game.board.length > 0 && <div>{game.board.map((card, index) => <PlayingCard small card={card} key={`${card}-${index}`} />)}</div>}</div>
          <div className="next-hand-status"><span>下一手自动发牌</span><b>{Math.max(0, Math.ceil(nextHandRemaining / 1000))}</b></div>
        </motion.div>}
        {room.status === "finished" && <motion.div className="winner-banner room-finished" initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }}>
          <p>ROOM COMPLETE · {room.hands.length} HANDS</p><h2>好友房已结束</h2>
          <div className="finish-ranking">{room.scoreboard.slice(0, 3).map((entry, index) => <div key={entry.seatId}><span>{index + 1}</span><i>{entry.avatar}</i><b>{entry.nickname}</b><strong className={entry.delta >= 0 ? "positive" : "negative"}>{entry.delta >= 0 ? "+" : ""}{entry.delta}</strong></div>)}</div>
          <div className="finish-actions"><button className="secondary-button" onClick={() => setDrawer("history")}>查看战绩</button><button className="primary-button" onClick={leaveRoom}>返回大厅</button></div>
        </motion.div>}
      </AnimatePresence>
    </div>

    {room.status === "playing" && mySeat && <ActionBar game={game} mySeatId={room.mySeatId} onAct={(action, raiseTo) => send({ type: "action", action, raiseTo })} />}
    <div className="rotate-hint"><span>↻</span><b>横屏体验更佳</b><small>旋转手机获得完整沉浸牌桌</small></div>
    {roomError && <div className="room-toast">{roomError}</div>}
    <AnimatePresence>{drawer && <><motion.div className="drawer-shade" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(null)} /><GameDrawer initialTab={drawer} room={room} onClose={() => setDrawer(null)} /></>}</AnimatePresence>
  </section>;
}

function WaitingRoom({ room, user, connectionStatus, onSit, onStart, onLeave }: { room: NonNullable<ReturnType<typeof useRoomStore.getState>["room"]>; user: User | null; connectionStatus: string; onSit(seatIndex: number): void; onStart(): void; onLeave(): void }) {
  const isHost = room.hostUserId === user?.id;
  const seatedCount = room.members.filter((member) => member.seatIndex !== null).length;
  const slots = Array.from({ length: room.capacity }, (_, index) => room.members.find((member) => member.seatIndex === index));
  const myPosition = room.members.find((member) => member.userId === user?.id)?.seatIndex ?? 0;
  return <section className="waiting-room">
    <header><button className="icon-button" onClick={onLeave}>‹</button><span className="brand compact"><i>♠</i>给我擦皮鞋</span><span className="hand-chip">房间 {room.code} · 等待开始</span><span className={`connection-pill ${connectionStatus}`}>● {connectionStatus === "connected" ? "实时连接" : "正在重连"}</span></header>
    <main className="waiting-table-stage">
      <div className="waiting-felt" />
      {slots.map((member, index) => {
        const relativePosition = (index - myPosition + room.capacity) % room.capacity;
        const angle = (Math.PI / 180) * (90 + relativePosition * 360 / room.capacity);
        const x = 50 + Math.cos(angle) * 42;
        const y = 49 + Math.sin(angle) * 39;
        const canChoose = !member || member.userId === user?.id;
        return <motion.button disabled={!canChoose} onClick={() => onSit(index)} className={`waiting-table-seat ${member ? "occupied" : "empty"} ${member?.userId === user?.id ? "mine" : ""}`} style={{ "--seat-x": `${x}%`, "--seat-y": `${y}%` } as CSSProperties} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay:index * .04 }} key={member?.userId ?? index}>
          <span>{member?.avatar ?? "＋"}{member && <i className={member.connected ? "online" : ""} />}</span>
          <b>{member?.nickname ?? "空位"}</b>
          <small>{member?.isHost ? "房主" : member ? `座位 ${index + 1}` : "等待加入"}</small>
        </motion.button>;
      })}
      <motion.div className="waiting-table-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <span className="waiting-state">{room.mySeatId ? "等待开局" : "请选择空位"}</span><h1>{seatedCount} / {room.capacity} 已入座</h1>
        <div className="room-rules"><span><small>时长</small><b>{room.durationMinutes} 分钟</b></span><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>筹码</small><b>{room.startingStack.toLocaleString()}</b></span></div>
        {isHost ? <button className="primary-button start-room-button" disabled={seatedCount < 3} onClick={onStart}>{seatedCount < 3 ? `还需 ${3 - seatedCount} 人落座` : "开始牌局 →"}</button> : <div className="guest-waiting"><span className="room-loader" /><b>{room.mySeatId ? "等待房主开始" : "请选择一个空位落座"}</b></div>}
      </motion.div>
    </main>
  </section>;
}
