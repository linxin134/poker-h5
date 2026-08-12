import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { useGameStore } from "../store/gameStore";

export function EffectsLayer({ seatPositions = {} }: { seatPositions?: Record<string, { x: number; y: number }> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bursts = useGameStore((state) => state.emojiBursts);
  const clear = useGameStore((state) => state.clearEmoji);
  const runtime = useRef<{ app: Application; layer: Container } | null>(null);
  const processed = useRef(new Set<string>());
  const [ready, setReady] = useState(false);

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
      setReady(true);
    });
    return () => {
      cancelled = true;
      runtime.current = null;
      if (initialized) app.destroy(true);
    };
  }, []);

  useEffect(() => {
    const current = runtime.current;
    if (!current || !ready) return;

    for (const pending of bursts) {
      if (processed.current.has(pending.id)) continue;
      processed.current.add(pending.id);
      if (processed.current.size > 100) processed.current.delete(processed.current.values().next().value!);

      const from = seatPositions[pending.from] ?? { x: .5, y: .82 };
      const to = seatPositions[pending.to] ?? { x: .78, y: .3 };
      const glyph = new Text({ text: pending.emoji, style: { fontSize: 48, dropShadow: { alpha: .48, blur: 5, distance: 2 } } });
      glyph.anchor.set(.5);
      glyph.position.set(current.app.screen.width * from.x, current.app.screen.height * from.y);
      current.layer.addChild(glyph);

      const sparks: Array<{ dot: Graphics; vx: number; vy: number }> = [];
      let ring: Graphics | null = null;
      let flightFrame = 0;
      let impactFrame = 0;

      const createImpact = () => {
        const targetX = current.app.screen.width * to.x;
        const targetY = current.app.screen.height * to.y;
        ring = new Graphics().circle(0, 0, 10).stroke({ color: 0xffd276, width: 3, alpha: .9 });
        ring.position.set(targetX, targetY);
        current.layer.addChild(ring);
        for (let index = 0; index < 14; index += 1) {
          const dot = new Graphics().circle(0, 0, 2 + Math.random() * 2.5).fill({ color: [0xf6c86c, 0xff7f6b, 0x77edbd][index % 3] });
          const angle = (Math.PI * 2 * index) / 14;
          dot.position.set(targetX, targetY);
          current.layer.addChild(dot);
          sparks.push({ dot, vx: Math.cos(angle) * (2.4 + Math.random() * 2.4), vy: Math.sin(angle) * (2.4 + Math.random() * 2.4) });
        }
      };

      const finish = () => {
        current.app.ticker.remove(tick);
        glyph.destroy();
        ring?.destroy();
        for (const spark of sparks) spark.dot.destroy();
        clear(pending.id);
      };

      const tick = () => {
        if (flightFrame < 42) {
          flightFrame += 1;
          const progress = Math.min(flightFrame / 42, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          glyph.x = current.app.screen.width * (from.x + (to.x - from.x) * eased);
          glyph.y = current.app.screen.height * (from.y + (to.y - from.y) * eased - .12 * Math.sin(progress * Math.PI));
          glyph.rotation = Math.sin(progress * Math.PI * 4) * .11;
          glyph.scale.set(.9 + Math.sin(progress * Math.PI) * .42);
          if (progress >= 1) createImpact();
          return;
        }

        impactFrame += 1;
        glyph.position.set(current.app.screen.width * to.x, current.app.screen.height * to.y);
        glyph.scale.set(1 + impactFrame / 22);
        glyph.alpha = Math.max(0, 1 - impactFrame / 18);
        if (ring) {
          ring.clear().circle(0, 0, 10 + impactFrame * 1.35).stroke({ color: 0xffd276, width: Math.max(1, 3 - impactFrame / 8), alpha: Math.max(0, 1 - impactFrame / 18) });
        }
        for (const spark of sparks) {
          spark.dot.x += spark.vx;
          spark.dot.y += spark.vy;
          spark.dot.alpha = Math.max(0, 1 - impactFrame / 18);
        }
        if (impactFrame >= 18) finish();
      };
      current.app.ticker.add(tick);
    }
  }, [bursts, clear, ready, seatPositions]);

  return <div
    className="pixi-effects"
    ref={hostRef}
    aria-hidden="true"
    data-active-effect-count={bursts.length}
    data-active-effects={bursts.map((burst) => `${burst.id}:${burst.from}>${burst.to}`).join(",")}
  />;
}
