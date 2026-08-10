import { Howler } from "howler";

type SoundKind = "check" | "chips" | "fold" | "street" | "win" | "emoji";

const tones: Record<SoundKind, [number, number, OscillatorType]> = {
  check: [360, .07, "sine"], chips: [820, .12, "triangle"], fold: [150, .13, "sine"],
  street: [520, .18, "triangle"], win: [740, .42, "sine"], emoji: [980, .12, "square"]
};

export function playSound(kind: SoundKind, volume = .7) {
  const context = Howler.ctx;
  if (!context || volume <= 0) return;
  void context.resume();
  const [frequency, duration, type] = tones[kind];
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  if (kind === "chips") oscillator.frequency.exponentialRampToValueAtTime(1180, context.currentTime + duration);
  if (kind === "win") oscillator.frequency.exponentialRampToValueAtTime(1480, context.currentTime + duration);
  gain.gain.setValueAtTime(Math.min(.16, volume * .16), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(Howler.masterGain);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}
