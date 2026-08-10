import { useState } from "react";
import { motion } from "motion/react";
import { useGameStore } from "../store/gameStore";
import { playSound } from "../services/audio";

const emojis = ["😂", "👏", "🚀", "🌮", "🍊", "🫡", "⚡", "💀"];

export function EmojiTray({ targetSeatId, onSend }: { targetSeatId: string; onSend(emoji: string, targetSeatId: string): void }) {
  const [open, setOpen] = useState(false);
  const volume = useGameStore((state) => state.settings.sound);
  return <div className="emoji-tray">
    {open && <motion.div className="emoji-popover" initial={{ opacity: 0, scale: .8, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}>
      {emojis.map((emoji) => <button key={emoji} onClick={() => { playSound("emoji", volume); onSend(emoji, targetSeatId); setOpen(false); }}>{emoji}</button>)}
    </motion.div>}
    <button className="round-tool" aria-label="发送互动表情" onClick={() => setOpen(!open)}>☺</button>
  </div>;
}
