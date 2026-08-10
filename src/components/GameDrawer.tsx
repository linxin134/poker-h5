import React from "react";
import { motion } from "motion/react";
import type { Card } from "../game/types";
import type { RoomView } from "../multiplayer/types";
import { useGameStore } from "../store/gameStore";
import { GameAvatar } from "./GameAvatar";

export type DrawerTab = "menu" | "chat" | "topup" | "settings" | "history" | "guide" | "stats";

export function GameDrawer({ initialTab, onClose, onLeave, onTopup, room }: { initialTab: DrawerTab; onClose(): void; onLeave(): void; onTopup(targetStack: number): void; room: RoomView }) {
  const savedTopup = room.members.find((member) => member.seatId === room.mySeatId)?.topUpTarget;
  const [tab, setTab] = React.useState(initialTab);
  const [chatText, setChatText] = React.useState("");
  const [messages, setMessages] = React.useState<Array<{ id: string; mine?: boolean; text: string }>>([
    { id: "system", text: "文明游戏，轻松交流" }
  ]);
  const [topup, setTopup] = React.useState(savedTopup ?? room.startingStack);
  const [topupSaved, setTopupSaved] = React.useState(Boolean(savedTopup));
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);
  const tabs: Array<[DrawerTab, string]> = [["history", "牌局回顾"], ["stats", "计分板"], ["chat", "聊天"], ["topup", "补筹码"]];
  const titles: Record<DrawerTab, string> = { menu: "牌桌功能", chat: "牌桌聊天", topup: "补充筹码", settings: "游戏设置", history: "牌局回顾", guide: "玩法说明", stats: "本局计分板" };
  const sendChat = (text: string) => {
    const clean = text.trim().slice(0, 40);
    if (!clean) return;
    setMessages((items) => [...items, { id: crypto.randomUUID(), mine: true, text: clean }]);
    setChatText("");
  };
  const saveTopup = () => {
    onTopup(topup);
    setTopupSaved(true);
  };
  return <motion.aside className={`game-drawer table-sheet tab-${tab}`} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}>
    <div className="sheet-handle" />
    <header><div><p className="eyebrow">ROOM {room.code}</p><h2>{titles[tab]}</h2></div><button className="icon-button" onClick={onClose}>×</button></header>
    {tab !== "menu" && <nav>{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>}
    <div className="drawer-content">
      {tab === "menu" && <div className="table-function-menu">
        <div className="function-grid">
          <FunctionButton icon="▤" label="牌局回顾" onClick={() => setTab("history")} />
          <FunctionButton icon="▥" label="本局计分" onClick={() => setTab("stats")} />
          <FunctionButton icon="▰" label="牌桌聊天" onClick={() => setTab("chat")} />
          <FunctionButton icon="＋" label="补充筹码" onClick={() => setTab("topup")} />
          <FunctionButton icon="?" label="玩法说明" onClick={() => setTab("guide")} />
          <FunctionButton icon="⚙" label="游戏设置" onClick={() => setTab("settings")} />
        </div>
        <div className="room-menu-meta"><span><small>盲注</small><b>{room.smallBlind} / {room.bigBlind}</b></span><span><small>入场筹码</small><b>{room.startingStack.toLocaleString()}</b></span><span><small>牌局时长</small><b>{room.durationMinutes} 分钟</b></span></div>
        <button className="leave-table-button" onClick={onLeave}>离开牌桌</button>
      </div>}

      {tab === "chat" && <div className="table-chat">
        <div className="quick-chat-list">{["快一点吧", "打得不错", "这手有点意思", "好运！"].map((text) => <button key={text} onClick={() => sendChat(text)}>{text}</button>)}</div>
        <div className="chat-messages">{messages.map((message) => <p className={message.mine ? "mine" : "system"} key={message.id}>{message.text}</p>)}</div>
        <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); sendChat(chatText); }}><input aria-label="聊天内容" value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="说点什么…" maxLength={40} /><button>发送</button></form>
      </div>}

      {tab === "topup" && <div className="topup-panel">
        <div className="topup-chip-visual"><i /><i /><i /><b>{topup.toLocaleString()}</b><small>目标筹码</small></div>
        <div className="topup-presets">{[room.startingStack, room.startingStack * 2, room.startingStack * 3].map((amount) => <button className={topup === amount ? "active" : ""} onClick={() => { setTopup(amount); setTopupSaved(false); }} key={amount}>{amount.toLocaleString()}</button>)}</div>
        <input aria-label="补充筹码数量" type="range" min={room.startingStack} max={room.startingStack * 3} step={room.bigBlind * 5} value={topup} onChange={(event) => { setTopup(Number(event.target.value)); setTopupSaved(false); }} />
        <p>筹码不足目标值时，下一手开始前自动补至该数量。</p>
        <button className="primary-button topup-confirm" onClick={saveTopup}>{topupSaved ? "已设置自动补码" : "确认补码设置"}</button>
      </div>}

      {tab === "settings" && <div className="settings-list">
        <RangeSetting label="背景音乐" value={settings.music} onChange={(music) => updateSettings({ music })} />
        <RangeSetting label="游戏音效" value={settings.sound} onChange={(sound) => updateSettings({ sound })} />
        <RangeSetting label="动画速度" min={.5} max={2} step={.25} value={settings.animationSpeed} onChange={(animationSpeed) => updateSettings({ animationSpeed })} />
        <Toggle label="高质量粒子" checked={settings.effectQuality === "high"} onChange={(checked) => updateSettings({ effectQuality: checked ? "high" : "low" })} />
        <Toggle label="快速动画" checked={settings.fastMode} onChange={(fastMode) => updateSettings({ fastMode })} />
        <Toggle label="新手提示" checked={settings.tutorialHints} onChange={(tutorialHints) => updateSettings({ tutorialHints })} />
      </div>}

      {tab === "history" && <div className="room-hand-history">
        {room.hands.length === 0 && <Empty icon="▤" title="还没有战绩" body="每手结算后会记录公共牌、全桌最终手牌和筹码输赢。" />}
        {room.hands.map((hand) => <article className="hand-record-card" key={hand.id}>
          <header><div><span>第 {hand.handNumber} 手</span><b>{hand.winnerText}</b></div><strong>{hand.pot.toLocaleString()}</strong></header>
          <div className="record-board"><small>公共牌</small><CardStrip cards={hand.board} empty="翻牌前结束" /></div>
          <div className="record-seats">
            {hand.seats.map((seat) => <div className={`${seat.won ? "winner" : ""} ${seat.folded ? "folded" : ""}`} key={seat.seatId}>
              <span className="record-avatar"><GameAvatar seed={seat.seatId} label={seat.nickname} /></span>
              <span className="record-player"><b>{seat.nickname}</b><small>{seat.folded ? "弃牌" : seat.won ? "获胜" : "摊牌"}</small></span>
              <CardStrip cards={seat.cards} />
              <PixelChip value={seat.delta} compact />
            </div>)}
          </div>
        </article>)}
      </div>}

      {tab === "stats" && <div className="room-scoreboard">
        <div className="score-summary"><span>本房积分榜</span><b>{room.hands.length} 手</b><small>以入场筹码 {room.startingStack.toLocaleString()} 为基准</small></div>
        {room.scoreboard.map((entry, index) => <article className={entry.seatId === room.mySeatId ? "me" : ""} key={entry.seatId}>
          <span className="score-rank">{index + 1}</span>
          <span className="score-avatar"><GameAvatar seed={entry.seatId} label={entry.nickname} /><i className={entry.connected ? "online" : ""} /></span>
          <span className="score-player"><b>{entry.nickname}</b><small>{entry.stack.toLocaleString()} 筹码</small></span>
          <PixelChip value={entry.delta} />
        </article>)}
      </div>}

      {tab === "guide" && <div className="guide-list">
        <Guide n="01" title="真实多人好友房">每位玩家使用自己的账号和席位，只有轮到本人时才能行动；服务端校验所有下注。</Guide>
        <Guide n="02" title="自动续手">每手结算停留 3.5 秒供全桌看牌，随后服务端自动洗牌并开始下一手。</Guide>
        <Guide n="03" title="房间计时">房间到时不会截断当前牌局；当前手正常结算后，房间停止发牌并锁定最终积分。</Guide>
        <div className="hand-order"><b>牌型顺序</b><p>皇家同花顺 → 同花顺 → 四条 → 葫芦 → 同花 → 顺子 → 三条 → 两对 → 一对 → 高牌</p></div>
      </div>}
    </div>
  </motion.aside>;
}

function FunctionButton({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return <button onClick={onClick}><span>{icon}</span><b>{label}</b></button>;
}

function CardStrip({ cards, empty }: { cards: Card[]; empty?: string }) {
  if (!cards.length) return <span className="record-empty">{empty ?? "—"}</span>;
  return <span className="record-cards">{cards.map((card, index) => {
    const red = card.includes("♥") || card.includes("♦");
    return <i className={red ? "red" : ""} key={`${card}-${index}`}>{card.replace("T", "10")}</i>;
  })}</span>;
}

function PixelChip({ value, compact = false }: { value: number; compact?: boolean }) {
  return <span className={`pixel-chip ${value >= 0 ? "positive" : "negative"} ${compact ? "compact" : ""}`}><i /><b>{value >= 0 ? "+" : ""}{value.toLocaleString()}</b></span>;
}

function RangeSetting({ label, value, onChange, min = 0, max = 1, step = .05 }: { label: string; value: number; onChange(value: number): void; min?: number; max?: number; step?: number }) {
  return <label className="drawer-setting"><span>{label}<b>{Math.round(value * (max <= 2 ? 100 : 1))}{max === 1 ? "%" : ""}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) { return <label className="toggle-setting"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>; }
function Empty({ icon, title, body }: { icon: string; title: string; body: string }) { return <div className="empty-state"><span>{icon}</span><b>{title}</b><p>{body}</p></div>; }
function Guide({ n, title, children }: { n: string; title: string; children: React.ReactNode }) { return <article><span>{n}</span><div><b>{title}</b><p>{children}</p></div></article>; }
