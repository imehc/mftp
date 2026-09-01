/**
 * 击球反馈：用 WebAudio 合成台球音效（无需外部素材——一段经过滤波的
 * 噪声爆发听起来就很像球的“咔哒”声），并在平台支持时叠加轻微震动
 * （Android；iOS 的 WebView 没有振动 API，自动跳过）。
 *
 * WebView 常常以 suspended 状态启动 AudioContext；每次播放尝试都会
 * 触发 resume()，以便平台一旦允许就恢复出声。所有输出都经过主增益——
 * 见 setGameAudioVolume。
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

/** 至少在用户手势中调用一次（iOS 自动播放策略）。 */
export function unlockAudio(): void {
  ensureContext();
}

/** 主音量 0..1；为 0 时直接跳过合成。 */
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

/** 由相对速度（米/秒）归一化得到的撞击响度。 */
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
  // 仅 Android WebView；iOS 没有 navigator.vibrate。
  navigator.vibrate?.(ms);
}
