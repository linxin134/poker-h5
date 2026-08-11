import React from "react";
import { motion } from "motion/react";
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
  history: "right",
  topup: "modal",
  settings: "modal",
  guide: "modal"
};

export function GameDrawer({ initialTab, onClose, onLeave, onTopup, room }: { initialTab: DrawerTab; onClose(): void; onLeave(): void; onTopup(targetStack: number): void; room: RoomView }) {
  const savedTopup = room.members.find((member) => member.seatId === room.mySeatId)?.topUpTarget;
  const [tab, setTab] = React.useState(initialTab);
  const [chatText, setChatText] = React.useState("");
  const [messages, setMessages] = React.useState<Array<{ id: string; mine?: boolean; text: string }>>([
    { id: "system", text: "牌桌聊天仅在本机显示，请文明交流。" }
  ]);
  const [topup, setTopup] = React.useState(savedTopup ?? room.startingStack);
  const [topupSaved, setTopupSaved] = React.useState(Boolean(savedTopup));
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);
  const side = drawerSide[tab];
  const seatedMembers = room.members.filter((member) => member.seatIndex !== null);
  const spectators = room.members.filter((member) => member.seatIndex === null);
  const totalPot = room.hands.reduce((sum, hand) => sum + hand.pot, 0);
  const elapsedMinutes = Math.max(0, Math.floor(((room.endsAt ? Math.min(room.endsAt, Date.now()) : Date.now()) - (room.startedAt ?? Date.now())) / 60_000));
  const remainingMinutes = room.endsAt ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 60_000)) : room.durationMinutes;

  const switchTab = (next: DrawerTab) => setTab(next);
  const sendChat = () => {
    const clean = chatText.trim().slice(0, 40);
    if (!clean) return;
    setMessages((items) => [...items, { id: crypto.randomUUID(), mine: true, text: clean }]);
    setChatText("");
  };
  const saveTopup = () => {
    onTopup(topup);
    setTopupSaved(true);
  };
  const initial = side === "left" ? { x: "-100%" } : side === "right" ? { x: "100%" } : side === "menu" ? { opacity: 0, scale: .92, x: -8, y: -8 } : { opacity: 0 };
  const animate = side === "left" || side === "right" ? { x: 0 } : side === "menu" ? { opacity: 1, scale: 1, x: 0, y: 0 } : { opacity: 1 };
  const exit = initial;

  return <motion.aside className={`game-drawer wpk-panel drawer-${side} tab-${tab}`} initial={initial} animate={animate} exit={exit} transition={{ duration: .22, ease: "easeOut" }}>
    {tab === "menu" ? <div className="wpk-function-menu">
      <MenuButton icon="leave" label="退出牌局" onClick={onLeave} />
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
        <div className="wpk-chat-messages">{messages.map((message) => <div className={message.mine ? "mine" : "system"} key={message.id}><i>♠</i><p>{message.text}</p></div>)}</div>
        <form className="wpk-chat-compose" onSubmit={(event) => { event.preventDefault(); sendChat(); }}>
          <button type="button" aria-label="添加表情" onClick={() => setChatText((value) => `${value}🙂`)}><UiIcon name="smile" /></button>
          <input aria-label="聊天内容" value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="说点什么…" maxLength={40} />
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
            <span className="wpk-rank-avatar"><GameAvatar seed={entry.seatId} label={entry.nickname} /></span>
            <div><b>{entry.nickname}</b><p><span>入池 {playerHands.length ? "100" : "0"}%</span><span>胜率 {playerHands.length ? Math.round(wins / playerHands.length * 100) : 0}%</span><span>带入 {(member?.buyIn || room.startingStack).toLocaleString()}</span></p></div>
            <PixelChip value={entry.delta} />
          </article>;
        })}</div>
        <section className="wpk-spectators">
          <header><span>旁观人员</span><b>{spectators.length} 人</b></header>
          {spectators.length === 0 ? <p>暂无旁观人员</p> : spectators.map((member) => <article key={member.userId}>
            <span><GameAvatar seed={member.userId} label={member.nickname} /></span>
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
        {room.hands.length === 0 ? <Empty icon="▤" title="暂时还没有牌局回顾" body="每一手结束后，会在这里展示公共牌、所有玩家最终手牌和积分变化。" /> : room.hands.map((hand) => <article className="hand-record-card" key={hand.id}>
          <header><div><span>第 {hand.handNumber} 手</span><b>{hand.winnerText}</b></div><strong>{hand.pot.toLocaleString()}</strong></header>
          <div className="record-board"><small>公共牌</small><CardStrip cards={hand.board} empty="翻牌前结束" /></div>
          <div className="record-seats">{hand.seats.map((seat) => <div className={`${seat.won ? "winner" : ""} ${seat.folded ? "folded" : ""}`} key={seat.seatId}>
            <span className="record-avatar"><GameAvatar seed={seat.seatId} label={seat.nickname} /></span>
            <span className="record-player"><b>{seat.nickname}</b><small>{seat.folded ? "弃牌" : seat.won ? "获胜" : "摊牌"}</small></span>
            <CardStrip cards={seat.cards} />
            <PixelChip value={seat.delta} compact />
          </div>)}</div>
        </article>)}
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
        <Guide n="02" title="自动续手">每手结算后公开全桌最终手牌，随后自动洗牌并发下一手。</Guide>
        <Guide n="03" title="中途加入">牌局开始后仍可进入空位，落座玩家从下一手开始参与。</Guide>
        <div className="hand-order"><b>牌型顺序</b><p>皇家同花顺 → 同花顺 → 四条 → 葫芦 → 同花 → 顺子 → 三条 → 两对 → 一对 → 高牌</p></div>
      </div>}
    </>}
  </motion.aside>;
}

function MenuButton({ icon, label, onClick }: { icon: UiIconName; label: string; onClick(): void }) { return <button onClick={onClick}><span><UiIcon name={icon} /></span><b>{label}</b></button>; }
function Metric({ label, value }: { label: string; value: string }) { return <span><small>{label}</small><b>{value}</b></span>; }
function CardStrip({ cards, empty }: { cards: Card[]; empty?: string }) {
  if (!cards.length) return <span className="record-empty">{empty ?? "—"}</span>;
  return <span className="record-cards">{cards.map((card, index) => {
    const red = card.includes("♥") || card.includes("♦");
    return <i className={red ? "red" : ""} key={`${card}-${index}`}>{card.replace("T", "10")}</i>;
  })}</span>;
}
function PixelChip({ value, compact = false }: { value: number; compact?: boolean }) { return <span className={`pixel-chip ${value >= 0 ? "positive" : "negative"} ${compact ? "compact" : ""}`}><i /><b>{value >= 0 ? "+" : ""}{value.toLocaleString()}</b></span>; }
function RangeSetting({ label, value, onChange, min = 0, max = 1, step = .05 }: { label: string; value: number; onChange(value: number): void; min?: number; max?: number; step?: number }) { return <label className="drawer-setting"><span>{label}<b>{Math.round(value * (max <= 2 ? 100 : 1))}{max === 1 ? "%" : ""}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function Empty({ icon, title, body }: { icon: string; title: string; body: string }) { return <div className="empty-state"><span>{icon}</span><b>{title}</b><p>{body}</p></div>; }
function Guide({ n, title, children }: { n: string; title: string; children: React.ReactNode }) { return <article><span>{n}</span><div><b>{title}</b><p>{children}</p></div></article>; }
