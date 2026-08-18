import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGameStore } from "../store/gameStore";
import { playSound } from "../services/audio";
import { UiIcon } from "./UiIcon";

const emojis = ["😂", "👏", "😎", "🤔", "😭", "😤", "🫡", "💀"];
const props = ["🌹", "🍅", "🍺", "💣", "💋", "🎂", "⚡", "🏆"];

export function EmojiTray({ targetSeatId, targets, onSendExpression, onSendInteraction }: {
  targetSeatId: string;
  targets: Array<{ id: string; name: string }>;
  onSendExpression(emoji: string): void;
  onSendInteraction(emoji: string, targetSeatId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "prop">("emoji");
  const [target, setTarget] = useState(targetSeatId);
  const volume = useGameStore((state) => state.settings.sound);
  useEffect(() => {
    const validIds = new Set(targets.map((item) => item.id));
    setTarget((current) => {
      if (validIds.has(current)) return current;
      if (validIds.has(targetSeatId)) return targetSeatId;
      return targets[0]?.id ?? "";
    });
  }, [open, targetSeatId, targets]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    <AnimatePresence>
      {open && <>
        <motion.div className="emoji-popover-backdrop" aria-hidden="true" onPointerDown={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <motion.div role="dialog" aria-label="互动表情" aria-modal="true" className="emoji-popover interaction-popover" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} onPointerDown={(event) => event.stopPropagation()}>
          <header><nav><button className={tab === "emoji" ? "active" : ""} onClick={() => setTab("emoji")}>表情</button><button className={tab === "prop" ? "active" : ""} onClick={() => setTab("prop")}>互动</button></nav><button className="popover-close" aria-label="关闭表情面板" onClick={() => setOpen(false)}><UiIcon name="close" /></button></header>
          {tab === "prop" && <div className="emoji-targets">{targets.map((item) => <button className={target === item.id ? "active" : ""} onClick={() => setTarget(item.id)} key={item.id}>{item.name}</button>)}</div>}
          <div className="emoji-grid">{(tab === "emoji" ? emojis : props).map((emoji) => <button key={emoji} disabled={tab === "prop" && !targets.length} onClick={() => {
            playSound("emoji", volume);
            if (tab === "emoji") {
              onSendExpression(emoji);
            } else {
              const validTarget = targets.some((item) => item.id === target) ? target : targets.some((item) => item.id === targetSeatId) ? targetSeatId : targets[0]?.id;
              if (!validTarget) return;
              onSendInteraction(emoji, validTarget);
            }
            setOpen(false);
          }}>{emoji}</button>)}</div>
        </motion.div>
      </>}
    </AnimatePresence>
    <div className="emoji-tray"><button className="round-tool" aria-label="发送互动表情" onClick={() => setOpen(!open)}><UiIcon name="smile" /></button></div>
  </>;
}
