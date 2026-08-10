import React from "react";
import { motion } from "motion/react";
import type { Card } from "../game/types";
import type { RoomView } from "../multiplayer/types";
import { useGameStore } from "../store/gameStore";

type DrawerTab = "settings" | "history" | "guide" | "stats";

export function GameDrawer({ initialTab, onClose, room }: { initialTab: DrawerTab; onClose(): void; room: RoomView }) {
  const [tab, setTab] = React.useState(initialTab);
  const settings = useGameStore((state) => state.settings);
  const updateSettings = useGameStore((state) => state.updateSettings);
  const tabs: Array<[DrawerTab, string]> = [["settings", "设置"], ["history", "战绩"], ["stats", "积分"], ["guide", "玩法"]];
  return <motion.aside className="game-drawer" initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}>
    <header><div><p className="eyebrow">ROOM {room.code}</p><h2>好友房中心</h2></div><button className="icon-button" onClick={onClose}>×</button></header>
    <nav>{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="drawer-content">
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
              <span className="record-avatar">{seat.avatar}</span>
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
          <span className="score-avatar">{entry.avatar}<i className={entry.connected ? "online" : ""} /></span>
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
