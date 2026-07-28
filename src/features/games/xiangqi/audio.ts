let context: AudioContext | null = null;
let knockNoise: AudioBuffer | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext;
  if (!AudioCtor) return null;
  context ??= new AudioCtor();
  return context;
}

export function unlockXiangqiAudio(): void {
  void getAudioContext()?.resume();
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (knockNoise) return knockNoise;
  const length = Math.ceil(ctx.sampleRate * 0.07);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length; index++) {
    const envelope = Math.exp((-index / length) * 10);
    samples[index] = (Math.random() * 2 - 1) * envelope;
  }
  knockNoise = buffer;
  return buffer;
}

function playWoodKnock(
  ctx: AudioContext,
  volume: number,
  delay: number,
  resonance: number,
): void {
  const start = ctx.currentTime + delay;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer(ctx);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(resonance, start);
  filter.Q.setValueAtTime(2.8, start);
  gain.gain.setValueAtTime(Math.max(0.001, volume * 0.42), start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.065);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
  source.stop(start + 0.075);

  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = "sine";
  body.frequency.setValueAtTime(resonance * 0.42, start);
  body.frequency.exponentialRampToValueAtTime(resonance * 0.3, start + 0.055);
  bodyGain.gain.setValueAtTime(Math.max(0.001, volume * 0.16), start);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
  body.connect(bodyGain).connect(ctx.destination);
  body.start(start);
  body.stop(start + 0.08);
}

function playResonance(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  volume: number,
  delay: number,
): void {
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(Math.max(0.001, volume * 0.12), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playMoveSound(volume: number, captured: boolean): void {
  const ctx = getAudioContext();
  if (!ctx || volume <= 0) return;
  playWoodKnock(ctx, volume, 0, captured ? 820 : 1060);
  if (captured) playWoodKnock(ctx, volume * 0.82, 0.065, 610);
}

export function playCheckSound(volume: number, checkmate = false): void {
  const ctx = getAudioContext();
  if (!ctx || volume <= 0) return;
  playResonance(ctx, checkmate ? 164.81 : 196, checkmate ? 0.48 : 0.34, volume, 0.105);
  playResonance(ctx, checkmate ? 246.94 : 293.66, checkmate ? 0.42 : 0.28, volume, 0.14);
  if (checkmate) playWoodKnock(ctx, volume, 0.12, 470);
}

export function playFinishSound(volume: number): void {
  const ctx = getAudioContext();
  if (!ctx || volume <= 0) return;
  playResonance(ctx, 261.63, 0.25, volume, 0.12);
  playResonance(ctx, 392, 0.32, volume, 0.2);
  playResonance(ctx, 523.25, 0.42, volume, 0.3);
}
