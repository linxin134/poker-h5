import { useState } from "react";
import { motion } from "motion/react";
import { useGameStore } from "../store/gameStore";
import { playSound } from "../services/audio";
import { UiIcon } from "./UiIcon";

const emojis = ["😂", "👏", "😎", "🤔", "😭", "😤", "🫡", "💀"];
const props = ["🌹", "🍅", "🍺", "💣", "💋", "🎂", "⚡", "🏆"];

export function EmojiTray({ targetSeatId, targets, onSend }: { targetSeatId: string; targets: Array<{ id: string; name: string }>; onSend(emoji: string, targetSeatId: string): void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "prop">("emoji");
  const [target, setTarget] = useState(targetSeatId);
  const volume = useGameStore((state) => state.settings.sound);
  return <>
    {open && <motion.div className="emoji-popover interaction-popover" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <header><nav><button className={tab === "emoji" ? "active" : ""} onClick={() => setTab("emoji")}>表情</button><button className={tab === "prop" ? "active" : ""} onClick={() => setTab("prop")}>互动</button></nav><button className="popover-close" aria-label="关闭表情面板" onClick={() => setOpen(false)}><UiIcon name="close" /></button></header>
      <div className="emoji-targets">{targets.map((item) => <button className={target === item.id ? "active" : ""} onClick={() => setTarget(item.id)} key={item.id}>{item.name}</button>)}</div>
      <div className="emoji-grid">{(tab === "emoji" ? emojis : props).map((emoji) => <button key={emoji} onClick={() => { playSound("emoji", volume); onSend(emoji, target || targetSeatId); setOpen(false); }}>{emoji}</button>)}</div>
    </motion.div>}
    <div className="emoji-tray"><button className="round-tool" aria-label="发送互动表情" onClick={() => setOpen(!open)}><UiIcon name="smile" /></button></div>
  </>;
}
