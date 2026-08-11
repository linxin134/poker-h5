import React from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Card } from "../game/types";
import type { RoomView } from "../multiplayer/types";
import { useGameStore } from "../store/gameStore";
import { GameAvatar } from "./GameAvatar";
import { UiIcon, type UiIconName } from "./UiIcon";

export type DrawerTab = "menu" | "chat" | "topup" | "settings" | "history" | "guide" | "stats";

const drawerSide: Record<DrawerTab, "left" | "right" | "modal" | "menu"> = {
  menu: "menu",
  chat: "left",
  stats: "left",
  history: "left",
  topup: "modal",
  settings: "modal",
  guide: "modal"
};

export function GameDrawer({ initialTab, onClose, onLeave, onDissolve, onStand, onTopup, onChat, currentUserId, room }: { initialTab: DrawerTab; onClose(): void; onLeave(): void; onDissolve(): void; onStand(): void; onTopup(targetStack: number): void; onChat(text: string): void; currentUserId: string; room: RoomView }) {
  const savedTopup = room.members.find((member) => member.seatId === room.mySeatId)?.topUpTarget;
  const currentMember = room.members.find((member) => member.userId === currentUserId);
  const [tab, setTab] = React.useState(initialTab);
  const [chatText, setChatText] = React.useState("");
  const chatListRef = React.useRef<HTMLDivElement>(null);
  const [historyIndex, setHistoryIndex] = React.useState(0);
  const [historyDirection, setHistoryDirection] = React.useState(1);
  const [topup, setTopup] = React.useState(savedTopup ?? room.startingStack);
  const [topupSaved, setTopupSaved] = React.useState(Boolean(savedTopup));
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);
  const side = drawerSide[tab];
  const seatedMembers = room.members.filter((member) => member.seatIndex !== null && !member.standingNow);
  const spectators = room.members.filter((member) => member.seatIndex === null || member.standingNow);
  const totalPot = room.hands.reduce((sum, hand) => sum + hand.pot, 0);
  const elapsedMinutes = Math.max(0, Math.floor(((room.endsAt ? Math.min(room.endsAt, Date.now()) : Date.now()) - (room.startedAt ?? Date.now())) / 60_000));
  const remainingMinutes = room.endsAt ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 60_000)) : room.durationMinutes;

  React.useEffect(() => {
    const list = chatListRef.current;
    if (tab === "chat" && list) list.scrollTop = list.scrollHeight;
  }, [room.chatMessages.length, tab]);

  React.useEffect(() => {
    setHistoryIndex((index) => Math.min(index, Math.max(0, room.hands.length - 1)));
  }, [room.hands.length]);

  const switchTab = (next: DrawerTab) => setTab(next);
  const sendChat = () => {
    const clean = chatText.trim().slice(0, 80);
    if (!clean) return;
    onChat(clean);
    setChatText("");
  };
  const saveTopup = () => {
    onTopup(topup);
    setTopupSaved(true);
  };
  const moveHistory = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(room.hands.length - 1, nextIndex));
    if (clamped === historyIndex) return;
    setHistoryDirection(clamped > historyIndex ? 1 : -1);
    setHistoryIndex(clamped);
  };
  const visibleHand = room.hands[historyIndex];
  const initial = side === "left" ? { x: "-100%" } : side === "right" ? { x: "100%" } : side === "menu" ? { opacity: 0, scale: .94, x: -6, y: -6 } : { opacity: 0, scale: .96, x: 0, y: 0 };
  const animate = side === "left" || side === "right" ? { x: 0 } : side === "menu" ? { opacity: 1, scale: 1, x: 0, y: 0 } : { opacity: 1, scale: 1, x: 0, y: 0 };
  const exit = side === "modal" ? { opacity: 0, scale: .96, x: 0, y: 0 } : initial;

  return <motion.aside key={`${side}-${tab}`} className={`game-drawer wpk-panel drawer-${side} tab-${tab}`} initial={initial} animate={animate} exit={exit} transition={{ duration: .22, ease: "easeOut" }}>
    {tab === "menu" ? <div className="wpk-function-menu">
      <MenuButton icon="leave" label="退出牌局" onClick={onLeave} />
      {currentMember?.seatIndex !== null && !currentMember?.standingNow && <MenuButton icon="user" label={currentMember?.standAfterHand ? "取消本手后旁观" : "站起旁观"} onClick={onStand} />}
      {room.hostUserId === currentUserId && <MenuButton icon="close" label="解散房间" onClick={onDissolve} />}
      <MenuButton icon="history" label="牌局回顾" onClick={() => switchTab("history")} />
      <MenuButton icon="stats" label="实时排名" onClick={() => switchTab("stats")} />
      <MenuButton icon="rules" label="规则说明" onClick={() => switchTab("guide")} />
      <MenuButton icon="chips" label="补充记分牌" onClick={() => switchTab("topup")} />
      <MenuButton icon="settings" label="桌面设置" onClick={() => switchTab("settings")} />
    </div> : <>
      <header className="wpk-panel-header">
        <button className="panel-back" aria-label="返回功能菜单" onClick={() => tab === "chat" || tab === "stats" || tab === "history" ? onClose() : switchTab("menu")}><UiIcon name="back" /></button>
        <h2>{tab === "chat" ? "牌桌聊天" : tab === "stats" ? "实时排名" : tab === "history" ? "牌局回顾" : tab === "topup" ? "补充记分牌" : tab === "settings" ? "桌面设置" : "规则说明"}</h2>
        <button className="panel-close" aria-label="关闭" onClick={onClose}><UiIcon name="close" /></button>
      </header>

      {tab === "chat" && <div className="wpk-chat-panel">
        <div className="wpk-chat-messages" ref={chatListRef}>{room.chatMessages.length === 0
          ? <div className="chat-empty"><p>还没有消息，和牌友打个招呼吧</p></div>
          : room.chatMessages.map((message) => <div className={message.userId === currentUserId ? "mine" : "other"} key={message.id}>
            <i><GameAvatar seed={message.avatar || message.userId} label={message.nickname} /></i>
            <span><small>{message.nickname}</small><p>{message.text}</p></span>
          </div>)}</div>
        <form className="wpk-chat-compose" onSubmit={(event) => { event.preventDefault(); sendChat(); }}>
          <button type="button" aria-label="添加表情" onClick={() => setChatText((value) => `${value}🙂`)}><UiIcon name="smile" /></button>
          <input aria-label="聊天内容" value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="说点什么…" maxLength={80} />
          <button className="send" aria-label="发送" type="submit"><UiIcon name="send" /></button>
        </form>
      </div>}

      {tab === "stats" && <div className="wpk-stats-panel">
        <div className="wpk-stats-filter"><span>桌面玩家</span><b>{seatedMembers.length} 人</b></div>
        <div className="wpk-ranking-list">{room.scoreboard.map((entry, index) => {
          const member = room.members.find((item) => item.seatId === entry.seatId);
          const playerHands = room.hands.filter((hand) => hand.seats.some((seat) => seat.seatId === entry.seatId));
          const wins = playerHands.filter((hand) => hand.seats.some((seat) => seat.seatId === entry.seatId && seat.won)).length;
          return <article className={entry.seatId === room.mySeatId ? "me" : ""} key={entry.seatId}>
            <span className="wpk-rank">{index + 1}</span>
            <span className="wpk-rank-avatar"><GameAvatar seed={entry.avatar || entry.seatId} label={entry.nickname} /></span>
            <div><b>{entry.nickname}</b><p><span>入池 {playerHands.length ? "100" : "0"}%</span><span>胜率 {playerHands.length ? Math.round(wins / playerHands.length * 100) : 0}%</span><span>带入 {(member?.buyIn || room.startingStack).toLocaleString()}</span></p></div>
            <PixelChip value={entry.delta} />
          </article>;
        })}</div>
        <section className="wpk-spectators">
          <header><span>旁观人员</span><b>{spectators.length} 人</b></header>
          {spectators.length === 0 ? <p>暂无旁观人员</p> : spectators.map((member) => <article key={member.userId}>
            <span><GameAvatar seed={member.avatar || member.userId} label={member.nickname} /></span>
            <b>{member.nickname}</b>
            <small className={member.connected ? "online" : ""}>{member.connected ? "在线旁观" : "已离线"}</small>
          </article>)}
        </section>
        <div className="wpk-table-metrics">
          <Metric label="全部流水" value={totalPot.toLocaleString()} />
          <Metric label="全部带入" value={seatedMembers.reduce((sum, item) => sum + (item.buyIn || room.startingStack), 0).toLocaleString()} />
          <Metric label="本局手数" value={String(room.hands.length)} />
          <Metric label="平均底池" value={room.hands.length ? Math.round(totalPot / room.hands.length).toLocaleString() : "0"} />
          <Metric label="本局时长" value={`${elapsedMinutes}m`} />
          <Metric label="剩余时间" value={`${remainingMinutes}m`} />
        </div>
      </div>}

      {tab === "history" && <div className="wpk-history-panel">
        <div className="history-room-meta"><span>给我擦皮鞋 · 房间ID：{room.code}</span><b>▥ {seatedMembers.length}/{room.capacity}</b></div>
        {room.hands.length === 0 ? <Empty icon="▤" title="暂时还没有牌局回顾" body="每一手结束后，会在这里展示公共牌、所有玩家最终手牌和积分变化。" /> : <>
          <nav className="history-pager" aria-label="牌局回顾翻页">
            <button aria-label="更早一手" disabled={historyIndex >= room.hands.length - 1} onClick={() => moveHistory(historyIndex + 1)}><UiIcon name="back" /></button>
            <span><b>第 {visibleHand.handNumber} 手</b><small>{historyIndex + 1} / {room.hands.length}</small></span>
            <button className="newer" aria-label="更新一手" disabled={historyIndex <= 0} onClick={() => moveHistory(historyIndex - 1)}><UiIcon name="back" /></button>
          </nav>
          <AnimatePresence mode="wait" initial={false} custom={historyDirection}>
            <motion.article
              className="hand-record-card history-page"
              key={visibleHand.id}
              custom={historyDirection}
              initial={{ opacity: 0, x: historyDirection > 0 ? 28 : -28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: historyDirection > 0 ? -28 : 28 }}
              transition={{ duration: .18, ease: "easeOut" }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={.12}
              onDragEnd={(_, info) => {
                if (info.offset.x < -45) moveHistory(historyIndex + 1);
                if (info.offset.x > 45) moveHistory(historyIndex - 1);
              }}
            >
              <header><div><span>第 {visibleHand.handNumber} 手</span><b>{visibleHand.board.length ? "本手牌面" : "翻牌前结束"}</b></div><strong>{visibleHand.pot.toLocaleString()}</strong></header>
              <div className="record-board"><small>公共牌</small><CardStrip cards={visibleHand.board} empty="翻牌前结束" /></div>
              <div className="record-seats">{visibleHand.seats.map((seat) => <div key={seat.seatId}>
                <span className="record-avatar"><GameAvatar seed={seat.avatar || seat.seatId} label={seat.nickname} /></span>
                <span className="record-player"><b>{seat.nickname}</b><small>{seat.handName ?? (seat.folded ? "弃牌" : seat.showedDown ? "摊牌" : "未公开")}</small></span>
                <CardStrip cards={seat.cards} />
                <PixelChip value={seat.delta} compact />
              </div>)}</div>
            </motion.article>
          </AnimatePresence>
        </>}
      </div>}

      {tab === "topup" && <div className="wpk-topup-panel">
        <strong>{topup.toLocaleString()}</strong>
        <small>({Math.round(topup / room.bigBlind)}BB)</small>
        <p>带入记分牌</p>
        <input aria-label="补充记分牌数量" type="range" min={room.startingStack} max={room.startingStack * 3} step={room.bigBlind} value={topup} onChange={(event) => { setTopup(Number(event.target.value)); setTopupSaved(false); }} />
        <div className="topup-range-labels"><span>最小</span><span>最大</span></div>
        <em>您补充的记分牌将在本手结束后带入</em>
        <button onClick={saveTopup}>{topupSaved ? "已设置" : "带入"}</button>
      </div>}

      {tab === "settings" && <div className="wpk-settings-panel">
        <RangeSetting label="游戏音效" value={settings.sound} onChange={(sound) => updateSettings({ sound })} />
        <RangeSetting label="动画速度" min={.5} max={2} step={.25} value={settings.animationSpeed} onChange={(animationSpeed) => updateSettings({ animationSpeed })} />
      </div>}

      {tab === "guide" && <div className="wpk-guide-panel">
        <Guide n="01" title="多人好友房">每位玩家独立登录并选择座位，全部下注由服务器校验。</Guide>
        <Guide n="02" title="自动续手">每手结算后公开摊牌玩家手牌；弃牌玩家可自行选择公开任意底牌，随后自动洗牌并发下一手。</Guide>
        <Guide n="03" title="中途加入">牌局开始后仍可进入空位，落座玩家从下一手开始参与。</Guide>
        <div className="hand-order"><b>牌型顺序</b><p>皇家同花顺 → 同花顺 → 四条 → 葫芦 → 同花 → 顺子 → 三条 → 两对 → 一对 → 高牌</p></div>
      </div>}
    </>}
  </motion.aside>;
}

function MenuButton({ icon, label, onClick }: { icon: UiIconName; label: string; onClick(): void }) { return <button onClick={onClick}><span><UiIcon name={icon} /></span><b>{label}</b></button>; }
function Metric({ label, value }: { label: string; value: string }) { return <span><small>{label}</small><b>{value}</b></span>; }
function CardStrip({ cards, empty }: { cards: Array<Card | null>; empty?: string }) {
  if (!cards.length) return <span className="record-empty">{empty ?? "—"}</span>;
  return <span className="record-cards">{cards.map((card, index) => {
    if (!card) return <i className="record-card-back" aria-label="未公开底牌" key={`hidden-${index}`}>♠</i>;
    const red = card.includes("♥") || card.includes("♦");
    return <i className={red ? "red" : ""} key={`${card}-${index}`}>{card.replace("T", "10")}</i>;
  })}</span>;
}
function PixelChip({ value, compact = false }: { value: number; compact?: boolean }) { return <span className={`pixel-chip ${value > 0 ? "positive" : value < 0 ? "negative" : "zero"} ${compact ? "compact" : ""}`}><b>{value > 0 ? "+" : ""}{value.toLocaleString()}</b><i /></span>; }
function RangeSetting({ label, value, onChange, min = 0, max = 1, step = .05 }: { label: string; value: number; onChange(value: number): void; min?: number; max?: number; step?: number }) { return <label className="drawer-setting"><span>{label}<b>{Math.round(value * (max <= 2 ? 100 : 1))}{max === 1 ? "%" : ""}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function Empty({ icon, title, body }: { icon: string; title: string; body: string }) { return <div className="empty-state"><span>{icon}</span><b>{title}</b><p>{body}</p></div>; }
function Guide({ n, title, children }: { n: string; title: string; children: React.ReactNode }) { return <article><span>{n}</span><div><b>{title}</b><p>{children}</p></div></article>; }
