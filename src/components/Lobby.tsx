import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { RoomDurationMinutes, RoomListItem } from "../multiplayer/types";
import { api, type User } from "../services/api";
import { useGameStore } from "../store/gameStore";
import { useRoomStore } from "../store/roomStore";
import { GameAvatar } from "./GameAvatar";

export function Lobby({ user, onLogin, onLogout }: { user: User | null; onLogin(): void; onLogout(): void }) {
  const setScreen = useGameStore((state) => state.setScreen);
  const connect = useRoomStore((state) => state.connect);
  const [seats, setSeats] = useState(6);
  const [stack, setStack] = useState(2000);
  const [durationMinutes, setDurationMinutes] = useState<RoomDurationMinutes>(30);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => { void api.rooms().then((result) => { if (active) setRooms(result.rooms); }).catch(() => undefined); };
    load();
    const timer = window.setInterval(load, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function createRoom() {
    if (!user) { onLogin(); return; }
    setBusy(true); setError("");
    try {
      const { code } = await api.createRoom({ durationMinutes, capacity: seats, startingStack: stack, smallBlind: 10, bigBlind: 20 });
      setCreateOpen(false);
      connect(code);
      setScreen("table");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建房间失败"); }
    finally { setBusy(false); }
  }

  async function joinRoom(code: string) {
    if (!user) { onLogin(); return; }
    setBusy(true); setError("");
    try {
      const result = await api.joinRoom(code);
      connect(result.code);
      setScreen("table");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加入房间失败"); }
    finally { setBusy(false); }
  }

  return <section className="lobby mobile-lobby">
    <header className="mobile-lobby-header">
      <a className="brand" href="#"><span className="brand-mark">♠</span><span>给我擦皮鞋</span></a>
      <div className="profile-actions">
        {user ? <><span className="profile-chip"><GameAvatar seed={user.id} label={user.nickname} /><b>{user.nickname}</b></span><button className="lobby-icon-button" aria-label="退出登录" onClick={onLogout}>↗</button></> : <button className="login-pill" onClick={onLogin}>登录</button>}
      </div>
    </header>

    <main className="mobile-lobby-main">
      <motion.section className="room-browser mobile-room-browser" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <header><div><h1>好友牌桌</h1><p>选择一个未满房间直接加入</p></div><span><i />{rooms.length} 桌</span></header>
        {rooms.length === 0 ? <button className="room-list-empty" onClick={() => setCreateOpen(true)}><span>♧</span><b>还没有牌桌</b><p>点击这里创建第一间好友房</p></button> : <div className="public-room-list">{rooms.map((room) => <article key={room.code}>
          <div className="room-host"><span><GameAvatar seed={room.hostNickname} label={room.hostNickname} /></span><div><small className={`room-state-badge ${room.status}`}>{room.status === "playing" ? `第 ${room.handNumber} 手 · 进行中` : "等待开局"}</small><b>{room.hostNickname} 的牌桌</b></div></div>
          <strong className="room-occupancy">{room.memberCount}<small>/{room.capacity}</small></strong>
          <div className="room-meta"><span><small>时长</small><b>{room.durationMinutes} 分钟</b></span><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>筹码</small><b>{room.startingStack.toLocaleString()}</b></span></div>
          <button disabled={busy} aria-label={`${room.status === "playing" ? "加入牌局" : "加入"} ${room.hostNickname} 的牌桌`} onClick={() => { void joinRoom(room.code); }}>{room.status === "playing" ? "加入牌局" : "加入"}<span>›</span></button>
        </article>)}</div>}
      </motion.section>
      {error && <p className="form-error lobby-error-toast">{error}</p>}
    </main>

    <nav className="mobile-lobby-nav" aria-label="大厅导航">
      <button className="active"><span>▥</span><small>牌桌</small></button>
      <button className="create-room-trigger" onClick={() => setCreateOpen(true)}><span>＋</span><small>创建房间</small></button>
      <button onClick={user ? undefined : onLogin}><span>♙</span><small>我的</small></button>
    </nav>

    <AnimatePresence>{createOpen && <motion.div className="room-sheet-shade" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setCreateOpen(false)}>
      <motion.section className="create-room-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 28, stiffness: 310 }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <header><div><h2>创建好友房</h2><p>3 人落座后，房主即可开始</p></div><button className="sheet-close" aria-label="关闭" onClick={() => setCreateOpen(false)}>×</button></header>
        <label className="setting-label"><span>人数上限</span><b>{seats} 人桌</b></label>
        <div className="segment-control">{[3, 6, 9].map((value) => <button key={value} className={seats === value ? "active" : ""} onClick={() => setSeats(value)}>{value} 人</button>)}</div>
        <label className="setting-label"><span>房间时长</span><b>{durationMinutes} 分钟</b></label>
        <div className="segment-control duration-control">{[30, 60].map((value) => <button key={value} className={durationMinutes === value ? "active" : ""} onClick={() => setDurationMinutes(value as RoomDurationMinutes)}>{value} 分钟</button>)}</div>
        <label className="setting-label"><span>入场筹码</span><b>{stack.toLocaleString()}</b></label>
        <input className="range" aria-label="入场筹码" type="range" min="1000" max="10000" step="500" value={stack} onChange={(event) => setStack(Number(event.target.value))} />
        <div className="sheet-summary"><span>盲注 <b>10 / 20</b></span><span>每手结束 <b>自动续局</b></span></div>
        <button className="primary-button create-confirm" disabled={busy} onClick={() => { void createRoom(); }}>{busy ? "正在创建…" : user ? "创建并进入" : "登录后创建"}</button>
        {error && <p className="form-error room-error">{error}</p>}
      </motion.section>
    </motion.div>}</AnimatePresence>
  </section>;
}
