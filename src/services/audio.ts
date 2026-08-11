export type SoundKind = "click" | "deal" | "check" | "chips" | "fold" | "street" | "allin" | "turn" | "countdown" | "collect" | "win" | "emoji";
export type VoiceAction = "fold" | "call" | "raise" | "all-in";
export const actionVoices: Readonly<Record<VoiceAction, { text: string; lang: string }>> = {
  fold: { text: "弃牌", lang: "zh-CN" },
  call: { text: "跟注", lang: "zh-CN" },
  raise: { text: "加注", lang: "zh-CN" },
  "all-in": { text: "ALL IN", lang: "en-US" }
};

interface SoundStep {
  frequency: number;
  duration: number;
  offset: number;
  type: OscillatorType;
  gain: number;
  endFrequency?: number;
}

export const soundPatterns: Readonly<Record<SoundKind, readonly SoundStep[]>> = {
  click: [{ frequency: 560, duration: .035, offset: 0, type: "sine", gain: .055 }],
  deal: [
    { frequency: 390, duration: .045, offset: 0, type: "triangle", gain: .085, endFrequency: 280 },
    { frequency: 430, duration: .045, offset: .065, type: "triangle", gain: .08, endFrequency: 310 }
  ],
  check: [{ frequency: 390, duration: .06, offset: 0, type: "sine", gain: .06, endFrequency: 470 }],
  chips: [
    { frequency: 840, duration: .07, offset: 0, type: "triangle", gain: .075, endFrequency: 1120 },
    { frequency: 1060, duration: .07, offset: .055, type: "triangle", gain: .06, endFrequency: 760 }
  ],
  fold: [{ frequency: 260, duration: .14, offset: 0, type: "sine", gain: .07, endFrequency: 105 }],
  street: [
    { frequency: 470, duration: .1, offset: 0, type: "triangle", gain: .06, endFrequency: 620 },
    { frequency: 650, duration: .12, offset: .09, type: "triangle", gain: .055, endFrequency: 840 }
  ],
  allin: [
    { frequency: 260, duration: .13, offset: 0, type: "sawtooth", gain: .07, endFrequency: 520 },
    { frequency: 520, duration: .18, offset: .11, type: "triangle", gain: .08, endFrequency: 1040 }
  ],
  turn: [
    { frequency: 720, duration: .08, offset: 0, type: "sine", gain: .06 },
    { frequency: 960, duration: .1, offset: .09, type: "sine", gain: .055 }
  ],
  countdown: [
    { frequency: 760, duration: .11, offset: 0, type: "sine", gain: .095, endFrequency: 690 },
    { frequency: 1040, duration: .055, offset: .012, type: "triangle", gain: .045, endFrequency: 900 }
  ],
  collect: [
    { frequency: 1180, duration: .08, offset: 0, type: "sine", gain: .09, endFrequency: 820 },
    { frequency: 1560, duration: .07, offset: .045, type: "triangle", gain: .075, endFrequency: 1040 },
    { frequency: 1320, duration: .08, offset: .1, type: "sine", gain: .08, endFrequency: 760 },
    { frequency: 1780, duration: .07, offset: .16, type: "triangle", gain: .07, endFrequency: 1120 },
    { frequency: 1460, duration: .09, offset: .23, type: "sine", gain: .075, endFrequency: 880 },
    { frequency: 1940, duration: .1, offset: .3, type: "triangle", gain: .065, endFrequency: 1240 }
  ],
  win: [
    { frequency: 523, duration: .16, offset: 0, type: "sine", gain: .07 },
    { frequency: 659, duration: .16, offset: .13, type: "sine", gain: .07 },
    { frequency: 784, duration: .34, offset: .26, type: "sine", gain: .085, endFrequency: 1046 }
  ],
  emoji: [{ frequency: 920, duration: .09, offset: 0, type: "square", gain: .045, endFrequency: 1160 }]
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

function audioGraph() {
  if (typeof window === "undefined") return null;
  if (!audioContext || audioContext.state === "closed") {
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    audioContext = new AudioContextConstructor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = .95;
    masterGain.connect(audioContext.destination);
  }
  return masterGain ? { context: audioContext, master: masterGain } : null;
}

export function unlockAudio() {
  const graph = audioGraph();
  if (graph?.context.state === "suspended") void graph.context.resume();
}

export function playSound(kind: SoundKind, volume = .7) {
  const graph = audioGraph();
  if (!graph || volume <= 0) return;
  if (graph.context.state === "suspended") {
    void graph.context.resume().then(() => scheduleSound(graph.context, graph.master, kind, volume));
    return;
  }
  scheduleSound(graph.context, graph.master, kind, volume);
}

export function speakAction(action: VoiceAction, volume = .7) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined" || volume <= 0) return;
  const config = actionVoices[action];
  const utterance = new SpeechSynthesisUtterance(config.text);
  utterance.lang = config.lang;
  utterance.rate = action === "all-in" ? .96 : .9;
  utterance.pitch = action === "all-in" ? 1.18 : 1.38;
  utterance.volume = Math.max(0, Math.min(1, volume));
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith(config.lang.slice(0, 2).toLowerCase())) ?? null;
  window.speechSynthesis.speak(utterance);
}

function scheduleSound(context: AudioContext, destination: AudioNode, kind: SoundKind, volume: number) {
  const start = context.currentTime + .005;
  if (kind === "deal") {
    scheduleNoise(context, destination, start, .055, volume * .11, 1700);
    scheduleNoise(context, destination, start + .07, .055, volume * .1, 1500);
  }
  for (const step of soundPatterns[kind]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + step.offset;
    oscillator.type = step.type;
    oscillator.frequency.setValueAtTime(step.frequency, at);
    if (step.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(step.endFrequency, at + step.duration);
    const peak = Math.max(.0001, Math.min(.14, volume * step.gain));
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(.012, step.duration / 3));
    gain.gain.exponentialRampToValueAtTime(.0001, at + step.duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(at);
    oscillator.stop(at + step.duration + .01);
  }
}

function scheduleNoise(context: AudioContext, destination: AudioNode, at: number, duration: number, volume: number, frequency: number) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) channel[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = .7;
  gain.gain.setValueAtTime(Math.max(.0001, Math.min(.16, volume)), at);
  gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(at);
  source.stop(at + duration + .01);
}
