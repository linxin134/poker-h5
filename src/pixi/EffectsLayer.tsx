import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { useGameStore } from "../store/gameStore";

export function EffectsLayer({ seatPositions = {} }: { seatPositions?: Record<string, { x: number; y: number }> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bursts = useGameStore((state) => state.emojiBursts);
  const clear = useGameStore((state) => state.clearEmoji);
  const runtime = useRef<{ app: Application; layer: Container } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    void app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio, 2) }).then(() => {
      initialized = true;
      if (cancelled) { app.destroy(true); return; }
      host.appendChild(app.canvas);
      const layer = new Container();
      app.stage.addChild(layer);
      runtime.current = { app, layer };
    });
    return () => {
      cancelled = true;
      runtime.current = null;
      if (initialized) app.destroy(true);
    };
  }, []);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const pending = bursts[bursts.length - 1];
    if (!pending) return;
    const glyph = new Text({ text: pending.emoji, style: { fontSize: 104, dropShadow: { alpha: .55, blur: 6, distance: 3 } } });
    glyph.anchor.set(.5);
    const from = seatPositions[pending.from] ?? { x: .5, y: .82 };
    const to = seatPositions[pending.to] ?? { x: .78, y: .3 };
    glyph.position.set(current.app.screen.width * from.x, current.app.screen.height * from.y);
    current.layer.addChild(glyph);
    const sparks = Array.from({ length: 18 }, () => {
      const dot = new Graphics().circle(0, 0, 2 + Math.random() * 4).fill({ color: [0xf6c86c, 0xff6b6b, 0x56e39f][Math.floor(Math.random() * 3)] });
      dot.position.copyFrom(glyph.position);
      current.layer.addChild(dot);
      return { dot, vx: (Math.random() - .5) * 9, vy: -Math.random() * 8 - 2, life: 70 };
    });
    let frame = 0;
    const tick = () => {
      frame += 1;
      const progress = Math.min(frame / 55, 1);
      glyph.x = current.app.screen.width * (from.x + (to.x - from.x) * progress);
      glyph.y = current.app.screen.height * (from.y + (to.y - from.y) * progress - .16 * Math.sin(progress * Math.PI));
      glyph.rotation = Math.sin(progress * Math.PI * 4) * .12;
      glyph.scale.set(1 + Math.sin(progress * Math.PI) * .45);
      sparks.forEach((spark) => { spark.dot.x += spark.vx; spark.dot.y += spark.vy; spark.vy += .18; spark.life -= 1; spark.dot.alpha = Math.max(0, spark.life / 70); });
      if (progress >= 1) {
        current.app.ticker.remove(tick);
        glyph.destroy(); sparks.forEach((spark) => spark.dot.destroy()); clear(pending.id);
      }
    };
    current.app.ticker.add(tick);
    return () => { current.app.ticker.remove(tick); };
  }, [bursts, clear]);

  return <div className="pixi-effects" ref={hostRef} aria-hidden="true" />;
}
