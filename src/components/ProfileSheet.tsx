import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { api, type User, type UserHandHistory, type UserRoomHistory } from "../services/api";
import { GameAvatar } from "./GameAvatar";
import { PlayingCard } from "./PlayingCard";
import { UiIcon } from "./UiIcon";

const AVATARS = Array.from({ length: 8 }, (_, index) => `avatar-${index}`);
type Stats = { hands: number; wins: number; profit: number; biggestPot: number };

export function ProfileSheet({ user, onClose, onUserChange }: { user: User; onClose(): void; onUserChange(user: User): void }) {
  const [tab, setTab] = useState<"profile" | "history">("profile");
  const [nickname, setNickname] = useState(user.nickname);
  const [avatar, setAvatar] = useState(user.avatar.startsWith("avatar-") || user.avatar.startsWith("data:image/") ? user.avatar : "avatar-0");
  const [stats, setStats] = useState<Stats>({ hands: 0, wins: 0, profit: 0, biggestPot: 0 });
  const [hands, setHands] = useState<UserHandHistory[]>([]);
  const [rooms, setRooms] = useState<UserRoomHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [expandedRoomCode, setExpandedRoomCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.stats(), api.history()]).then(([nextStats, history]) => {
      if (!active) return;
      setStats(nextStats);
      setHands(history.hands);
      setRooms(history.rooms);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "加载失败"));
    return () => { active = false; };
  }, []);

  const winRate = useMemo(() => stats.hands ? Math.round(stats.wins / stats.hands * 100) : 0, [stats]);

  async function saveProfile() {
    const clean = nickname.trim();
    if (clean.length < 2) { setError("昵称至少需要 2 个字符"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await api.updateProfile(clean, avatar);
      onUserChange(result.user);
      setNickname(result.user.nickname);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1_500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp)$/.test(file.type)) { setError("请选择 PNG、JPG 或 WebP 图片"); return; }
    if (file.size > 8 * 1024 * 1024) { setError("原图不能超过 8MB"); return; }
    setBusy(true);
    setError("");
    const source = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const next = new Image();
        next.onload = () => resolve(next);
        next.onerror = () => reject(new Error("图片读取失败"));
        next.src = source;
      });
      const size = 192;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法处理图片");
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
      const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
      const encoded = canvas.toDataURL("image/jpeg", .82);
      if (encoded.length > 240_000) throw new Error("图片压缩后仍然过大，请更换图片");
      setAvatar(encoded);
      setSaved(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片处理失败");
    } finally {
      URL.revokeObjectURL(source);
      setBusy(false);
    }
  }

  return <motion.section className="profile-sheet" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: .24, ease: "easeOut" }}>
    <header className="profile-sheet-header">
      <button aria-label="返回" onClick={onClose}><UiIcon name="back" /></button>
      <h2>我的</h2>
      <span />
    </header>
    <nav className="profile-tabs" aria-label="我的页面">
      <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>个人资料</button>
      <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>历史战绩</button>
    </nav>

    {tab === "profile" ? <div className="profile-content">
      <section className="profile-hero">
        <GameAvatar seed={avatar} label={nickname} />
        <div><b>{nickname}</b><small>{user.email}</small></div>
      </section>
      <section className="profile-stats">
        <Stat label="总手数" value={String(stats.hands)} />
        <Stat label="胜率" value={`${winRate}%`} />
        <Stat label="总积分" value={`${stats.profit > 0 ? "+" : ""}${stats.profit}`} tone={stats.profit > 0 ? "positive" : stats.profit < 0 ? "negative" : ""} />
        <Stat label="最大底池" value={stats.biggestPot.toLocaleString()} />
      </section>
      <section className="profile-editor">
        <label><span>昵称</span><input aria-label="昵称" value={nickname} maxLength={20} onChange={(event) => { setNickname(event.target.value); setSaved(false); }} /></label>
        <div className="avatar-picker"><span>选择头像</span><div>{AVATARS.map((candidate) => <button aria-label={`头像 ${candidate.slice(-1)}`} className={avatar === candidate ? "active" : ""} key={candidate} onClick={() => { setAvatar(candidate); setSaved(false); }}><GameAvatar seed={candidate} /></button>)}</div></div>
        <label className="avatar-upload"><input aria-label="上传自定义头像" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void uploadAvatar(event.target.files?.[0]); event.target.value = ""; }} /><span><UiIcon name="plus" />上传自定义头像</span></label>
      </section>
      {error && <p className="profile-error">{error}</p>}
      <button className="profile-save" disabled={busy} onClick={() => void saveProfile()}>{busy ? "保存中…" : saved ? "已保存" : "保存资料"}</button>
    </div> : <div className="personal-history">
      <header><b>{rooms.length} 场牌局</b><small>按房间保存最终计分</small></header>
      {error && <p className="profile-error">{error}</p>}
      {rooms.length === 0 ? <div className="personal-history-empty"><UiIcon name="history" /><b>还没有历史牌局</b><p>完成一手牌后，战绩会自动保存在这里。</p></div> : <div className="room-score-history">{rooms.map((room) => <RoomHistoryAccordion
        expanded={expandedRoomCode === room.roomCode}
        hands={hands.filter((hand) => hand.roomCode === room.roomCode)}
        key={room.roomCode}
        onToggle={() => setExpandedRoomCode((current) => current === room.roomCode ? null : room.roomCode)}
        room={room}
        user={user}
      />)}</div>}
    </div>}
  </motion.section>;
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div><small>{label}</small><b className={tone}>{value}</b></div>;
}

function RoomHistoryAccordion({ room, hands, user, expanded, onToggle }: { room: UserRoomHistory; hands: UserHandHistory[]; user: User; expanded: boolean; onToggle(): void }) {
  const date = new Date(room.completedAt);
  const myScore = room.scoreboard.find((entry) => entry.userId === user.id || (!entry.userId && entry.nickname === user.nickname));
  const tone = (myScore?.delta ?? 0) > 0 ? "positive" : (myScore?.delta ?? 0) < 0 ? "negative" : "zero";
  return <article className={`room-score-card ${expanded ? "expanded" : "collapsed"}`}>
    <button className="room-history-toggle" aria-expanded={expanded} onClick={onToggle}>
      <span><b>房间 {room.roomCode}</b><small>{date.toLocaleDateString("zh-CN")} · {room.handCount} 手</small></span>
      <strong className={tone}>{(myScore?.delta ?? 0) > 0 ? "+" : ""}{myScore?.delta ?? 0}<i /></strong>
      <UiIcon name="chevron" />
    </button>
    {expanded && <motion.div className="room-history-details" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
      <div className="room-final-score"><header><b>最终计分</b><small>按积分排序</small></header>{room.scoreboard.map((entry, index) => <p className={entry.userId === user.id ? "me" : ""} key={entry.userId ?? entry.nickname}>
        <em>{index + 1}</em><GameAvatar seed={entry.avatar || entry.userId || entry.nickname} label={entry.nickname} /><b>{entry.nickname}</b><small>{entry.finalStack.toLocaleString()}</small><strong className={entry.delta > 0 ? "positive" : entry.delta < 0 ? "negative" : "zero"}>{entry.delta > 0 ? "+" : ""}{entry.delta}<i /></strong>
      </p>)}</div>
      <div className="history-detail-title"><b>每手明细</b><small>仅展示已公开底牌</small></div>
      {hands.map((hand) => <HistoryHand key={`${hand.roomCode}-${hand.id}`} hand={hand} user={user} />)}
    </motion.div>}
  </article>;
}

function HistoryHand({ hand, user }: { hand: UserHandHistory; user: User }) {
  const seat = hand.seats.find((entry) => entry.userId === user.id || (!entry.userId && entry.nickname === user.nickname));
  if (!seat) return null;
  const date = new Date(hand.completedAt);
  const visibleCards = seat.cards.filter((card): card is NonNullable<typeof card> => Boolean(card));
  const deltaTone = seat.delta > 0 ? "positive" : seat.delta < 0 ? "negative" : "zero";
  return <article className="personal-hand-card">
    <header><span><b>第 {hand.handNumber} 手</b><small>{hand.roomCode} · {date.toLocaleDateString("zh-CN")} {date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span><strong className={deltaTone}>{seat.delta > 0 ? "+" : ""}{seat.delta}<i /></strong></header>
    <div className="personal-hand-board"><small>公共牌</small><span>{hand.board.map((card, index) => <PlayingCard card={card} small key={`${card}-${index}`} />)}</span></div>
    <div className="personal-hand-result">
      <GameAvatar seed={seat.avatar || user.avatar || user.id} label={seat.nickname} />
      <span><b>{seat.nickname}</b><small>{seat.folded ? "已弃牌" : seat.handName ?? (seat.showedDown ? "已摊牌" : "未摊牌")}</small></span>
      <div>{visibleCards.length ? visibleCards.map((card, index) => <PlayingCard card={card} small key={`${card}-${index}`} />) : <small>底牌未公开</small>}</div>
    </div>
  </article>;
}
