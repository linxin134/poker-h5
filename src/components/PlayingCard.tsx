import { motion } from "motion/react";
import { cardLabel } from "../game/cards";
import type { Card } from "../game/types";

export function PlayingCard({ card, hidden = false, delay = 0, small = false }: { card?: Card; hidden?: boolean; delay?: number; small?: boolean }) {
  const red = card?.includes("\u2665") || card?.includes("\u2666");
  const rank = card ? cardLabel(card).slice(0, -1) : "";
  const suit = card?.slice(-1) ?? "";
  const faceCard = rank === "J" || rank === "Q" || rank === "K";
  return (
    <motion.div aria-label={hidden ? "未公开手牌" : cardLabel(card!)} className={`playing-card ${small ? "small" : ""} ${hidden ? "card-back" : ""} ${red ? "red" : ""}`} initial={{ opacity: 0, y: hidden ? -22 : -5, rotateY: hidden ? 0 : 88, scale: hidden ? .92 : .96 }} animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }} transition={{ delay, type: "spring", stiffness: 260, damping: 20 }} style={{ transformStyle:"preserve-3d" }}>
      {!hidden && card && <>
        <span className="card-corner card-corner-top"><b>{rank}</b><i>{suit}</i></span>
        {!faceCard && <span className="card-suit"><i>{suit}</i><em>{rank}</em></span>}
        <span className="card-corner card-corner-bottom"><b>{rank}</b><i>{suit}</i></span>
      </>}
      {hidden && <span className="back-glyph"><i />{"\u2660"}</span>}
    </motion.div>
  );
}
