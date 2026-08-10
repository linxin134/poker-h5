import type { CSSProperties } from "react";
import avatarSprite from "../assets/avatar-sprite-v1.jpg";

function avatarIndex(seed: string) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 8;
}

export function GameAvatar({ seed, label, className = "" }: { seed: string; label?: string; className?: string }) {
  const index = avatarIndex(seed || "player");
  const column = index % 4;
  const row = Math.floor(index / 4);
  return <span
    className={`game-avatar ${className}`}
    role="img"
    aria-label={label ?? "玩家头像"}
    style={{
      backgroundImage: `url(${avatarSprite})`,
      backgroundPosition: `${column * 100 / 3}% ${row * 100}%`
    } as CSSProperties}
  />;
}
