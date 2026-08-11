import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { RoomDurationMinutes, RoomListItem } from "../multiplayer/types";
import { api, type User } from "../services/api";
import { useGameStore } from "../store/gameStore";
import { useRoomStore } from "../store/roomStore";
import { GameAvatar } from "./GameAvatar";
import { ProfileSheet } from "./ProfileSheet";
import { UiIcon } from "./UiIcon";

const BLINDS = [[1, 2], [2, 4], [5, 10], [10, 20], [20, 40]] as const;
const BUY_IN_BB = [50, 100, 200] as const;

export function Lobby({ user, onLogin, onLogout, onUserChange }: { user: User | null; onLogin(): void; onLogout(): void; onUserChange(user: User): void }) {
  const setScreen = useGameStore((state) => state.setScreen);
  const connect = useRoomStore((state) => state.connect);
  const [seats, setSeats] = useState(8);
  const [blindIndex, setBlindIndex] = useState(0);
  const [buyInBb, setBuyInBb] = useState<(typeof BUY_IN_BB)[number]>(100);
  const [durationMinutes, setDurationMinutes] = useState<RoomDurationMinutes>(30);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [smallBlind, bigBlind] = BLINDS[blindIndex];
  const stack = bigBlind * buyInBb;

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
      const { code } = await api.createRoom({ durationMinutes, capacity: seats, startingStack: stack, smallBlind, bigBlind });
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
        {user ? <><button className="profile-chip" onClick={() => setProfileOpen(true)}><GameAvatar seed={user.avatar || user.id} label={user.nickname} /><b>{user.nickname}</b></button><button className="lobby-icon-button" aria-label="退出登录" onClick={onLogout}><UiIcon name="leave" /></button></> : <button className="login-pill" onClick={onLogin}>登录</button>}
      </div>
    </header>

    <main className="mobile-lobby-main">
      <motion.section className="room-browser mobile-room-browser" aria-label="房间列表" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {rooms.length === 0 ? <button className="room-list-empty" onClick={() => setCreateOpen(true)}><span>♧</span><b>还没有牌桌</b><p>点击这里创建第一间好友房</p></button> : <div className="public-room-list">{rooms.map((room) => <article key={room.code}>
          <div className="room-host"><span><GameAvatar seed={room.hostAvatar || room.hostNickname} label={room.hostNickname} /></span><div><small className={`room-state-badge ${room.status}`}>{room.status === "playing" ? `第 ${room.handNumber} 手 · 进行中` : "等待开局"}</small><b>{room.hostNickname} 的牌桌</b></div></div>
          <strong className="room-occupancy">{room.memberCount}<small>/{room.capacity}</small></strong>
          <div className="room-meta"><span><small>时长</small><b>{room.durationMinutes} 分钟</b></span><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>筹码</small><b>{room.startingStack.toLocaleString()}</b></span></div>
          <button disabled={busy} aria-label={`加入 ${room.hostNickname} 的牌桌`} onClick={() => { void joinRoom(room.code); }}>加入<span>›</span></button>
        </article>)}</div>}
      </motion.section>
      {error && <p className="form-error lobby-error-toast">{error}</p>}
    </main>

    <nav className="mobile-lobby-nav" aria-label="大厅导航">
      <button className="active"><span><UiIcon name="cards" /></span><small>牌桌</small></button>
      <button className="create-room-trigger" onClick={() => setCreateOpen(true)}><span><UiIcon name="plus" /></span><small>创建房间</small></button>
      <button onClick={() => user ? setProfileOpen(true) : onLogin()}><span><UiIcon name="user" /></span><small>我的</small></button>
    </nav>

    <AnimatePresence>{createOpen && <motion.div className="room-sheet-shade wpk-create-shade" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="create-room-sheet wpk-create-room" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: .24, ease: "easeOut" }}>
        <header className="wpk-create-header"><button className="create-back" aria-label="返回" onClick={() => setCreateOpen(false)}><UiIcon name="back" /></button><h2>德州</h2><span /></header>
        <div className="wpk-room-config">
          <section className="config-card">
            <div className="config-title"><span>牌桌属性</span><b>公开房</b></div>
            <label className="config-row"><span>小盲/大盲</span><b>{smallBlind} / {bigBlind}</b></label>
            <input aria-label="盲注级别" type="range" min="0" max={BLINDS.length - 1} step="1" value={blindIndex} onChange={(event) => setBlindIndex(Number(event.target.value))} />
            <div className="range-ticks">{BLINDS.map(([small, big]) => <span key={small}>{small}/{big}</span>)}</div>

            <label className="config-row"><span>带入筹码</span><b>{stack.toLocaleString()} <small>({buyInBb}BB)</small></b></label>
            <div className="config-segments buyin-segments">{BUY_IN_BB.map((value) => <button key={value} className={buyInBb === value ? "active" : ""} onClick={() => setBuyInBb(value)}>{value}BB</button>)}</div>

            <label className="config-row"><span>房间时长</span><b>{durationMinutes === 30 ? "0.5 小时" : "1 小时"}</b></label>
            <div className="config-segments">{[30, 60].map((value) => <button key={value} className={durationMinutes === value ? "active" : ""} onClick={() => setDurationMinutes(value as RoomDurationMinutes)}>{value === 30 ? "0.5 小时" : "1 小时"}</button>)}</div>

            <label className="config-row"><span>牌桌人数</span><b>{seats} 人</b></label>
            <div className="config-segments player-count-segments">{[3, 6, 8, 9].map((value) => <button key={value} className={seats === value ? "active" : ""} onClick={() => setSeats(value)}>{value} 人</button>)}</div>
          </section>

          <div className="create-room-spacer" />
          <button className="primary-button create-confirm" disabled={busy} onClick={() => { void createRoom(); }}>{busy ? "正在创建…" : user ? "立即开局" : "登录后创建"}</button>
          {error && <p className="form-error room-error">{error}</p>}
        </div>
      </motion.section>
    </motion.div>}</AnimatePresence>
    <AnimatePresence>{profileOpen && user && <motion.div className="room-sheet-shade profile-sheet-shade" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <ProfileSheet user={user} onClose={() => setProfileOpen(false)} onUserChange={onUserChange} />
    </motion.div>}</AnimatePresence>
  </section>;
}
