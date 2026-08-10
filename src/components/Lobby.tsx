import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { RoomDurationMinutes, RoomListItem } from "../multiplayer/types";
import { api, type User } from "../services/api";
import { useGameStore } from "../store/gameStore";
import { useRoomStore } from "../store/roomStore";

export function Lobby({ user, onLogin, onLogout }: { user: User | null; onLogin(): void; onLogout(): void }) {
  const setScreen = useGameStore((state) => state.setScreen);
  const connect = useRoomStore((state) => state.connect);
  const [seats, setSeats] = useState(6);
  const [stack, setStack] = useState(2000);
  const [durationMinutes, setDurationMinutes] = useState<RoomDurationMinutes>(30);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
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

  return <section className="lobby functional-lobby">
    <header className="topbar lobby-topbar">
      <a className="brand" href="#"><span className="brand-mark">♠</span><span>给我擦皮鞋</span></a>
      <div className="profile-actions">
        {user ? <><span className="profile-chip">{user.avatar} {user.nickname}</span><button className="ghost-button" onClick={onLogout}>退出</button></> : <button className="ghost-button" onClick={onLogin}>注册 / 登录</button>}
      </div>
    </header>

    <main className="lobby-workspace">
      <motion.aside className="game-card create-room-panel" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
        <div className="game-card-head"><div><h2>创建房间</h2><p>至少 3 人落座后开始</p></div><span className="live-badge"><i /> 实时</span></div>
        <label className="setting-label"><span>人数上限</span><b>{seats} 人桌</b></label>
        <div className="segment-control">{[3, 6, 9].map((value) => <button key={value} className={seats === value ? "active" : ""} onClick={() => setSeats(value)}>{value} MAX</button>)}</div>

        <label className="setting-label"><span>房间时长</span><b>{durationMinutes} 分钟</b></label>
        <div className="segment-control duration-control">{[30, 60].map((value) => <button key={value} className={durationMinutes === value ? "active" : ""} onClick={() => setDurationMinutes(value as RoomDurationMinutes)}>{value} MIN</button>)}</div>

        <label className="setting-label"><span>入场筹码</span><b>{stack.toLocaleString()}</b></label>
        <input className="range" type="range" min="1000" max="10000" step="500" value={stack} onChange={(event) => setStack(Number(event.target.value))} />
        <div className="blind-row"><span>盲注</span><b>10 / 20</b><small>每手结算后自动发下一手</small></div>
        <button className="primary-button deal-button" disabled={busy} onClick={() => { void createRoom(); }}><span>{user ? "创建房间" : "登录后创建房间"}</span><b>→</b></button>
        {error && <p className="form-error room-error">{error}</p>}
      </motion.aside>

      <motion.section className="room-browser room-browser-main" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <header><div><h2>可加入牌桌</h2><p>等待中或进行中的未满牌桌均可加入</p></div><span>{rooms.length} 个可加入</span></header>
        {rooms.length === 0 ? <div className="room-list-empty"><span>♧</span><b>暂无可加入房间</b><p>可以先创建一个房间。</p></div> : <div className="public-room-list">{rooms.map((room) => <article key={room.code}>
          <div className="room-host"><span>{room.hostAvatar}</span><div><small className={`room-state-badge ${room.status}`}>{room.status === "playing" ? `进行中 · 第 ${room.handNumber} 手` : "等待开局"}</small><b>{room.hostNickname}</b></div></div>
          <div className="room-meta"><span><small>已落座</small><b>{room.memberCount} / {room.capacity}</b></span><span><small>时长</small><b>{room.durationMinutes} 分钟</b></span><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>筹码</small><b>{room.startingStack.toLocaleString()}</b></span></div>
          <button disabled={busy} onClick={() => { void joinRoom(room.code); }}>{room.status === "playing" ? "加入牌局" : "加入"} <span>→</span></button>
        </article>)}</div>}
      </motion.section>
    </main>
  </section>;
}
