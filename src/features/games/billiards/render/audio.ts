/**
 * Impact feedback: WebAudio-synthesized billiard sounds (no external
 * assets — a filtered noise burst reads convincingly as a ball "clack"),
 * plus light haptics where the platform supports it (Android; iOS
 * WebViews expose no vibration API and are skipped automatically).
 *
 * WebViews often start the AudioContext suspended; every play attempt
 * nudges resume() so sound recovers as soon as the platform allows it.
 * All output flows through a master gain — see setGameAudioVolume.
 */
import type { SimEvent } from "../types";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;

function ensureContext(): AudioContext | null {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture at least once (iOS autoplay policy). */
export function unlockAudio(): void {
  ensureContext();
}

/** Master volume 0..1; 0 also skips synthesis entirely. */
export function setGameAudioVolume(value: number): void {
  volume = clamp01(value);
  if (master) master.gain.value = volume;
}

function noiseBurst(
  duration: number,
  filterType: BiquadFilterType,
  frequency: number,
  q: number,
  gainValue: number,
): void {
  if (volume <= 0) return;
  const context = ensureContext();
  if (!context || !master || context.state !== "running") return;
  const sampleCount = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount) ** 2;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = context.createGain();
  gain.gain.value = gainValue;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Normalized impact loudness from a relative speed in m/s. */
function loudness(impact: number): number {
  return clamp01(impact / 5);
}

export function playImpactEvent(event: SimEvent): void {
  switch (event.type) {
    case "ball-ball": {
      const level = loudness(event.impact);
      if (level < 0.02) return;
      noiseBurst(0.035, "bandpass", 2600, 1.6, 0.9 * level);
      noiseBurst(0.012, "highpass", 5200, 0.8, 0.5 * level);
      vibrate(Math.round(8 + level * 14));
      break;
    }
    case "cushion": {
      const level = loudness(event.impact) * 0.7;
      if (level < 0.03) return;
      noiseBurst(0.05, "lowpass", 420, 0.9, 0.8 * level);
      break;
    }
    case "pocket": {
      noiseBurst(0.03, "bandpass", 1900, 1.2, 0.6);
      noiseBurst(0.14, "lowpass", 240, 0.8, 0.9);
      vibrate(20);
      break;
    }
  }
}

function vibrate(ms: number): void {
  // Android WebView only; iOS has no navigator.vibrate.
  navigator.vibrate?.(ms);
}
