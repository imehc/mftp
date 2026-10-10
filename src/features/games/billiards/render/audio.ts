/**
 * 击球反馈：用 WebAudio 播放随应用打包的真实台球录音，
 * 并在平台支持时叠加轻微震动
 * （Android；iOS 的 WebView 没有振动 API，自动跳过）。
 *
 * WebView 常常以 suspended 状态启动 AudioContext；每次播放尝试都会
 * 触发 resume()，以便平台一旦允许就恢复出声。所有输出都经过主增益——
 * 见 setGameAudioVolume。
 */
import type { SimEvent } from "../types";
import {
  type ImpactMaterial,
  type ImpactSamples,
  loadImpactSamples,
} from "./audio-samples";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;
const sources = new Set<AudioBufferSourceNode>();
let lastVibration = -Infinity;
let samples: ImpactSamples | null = null;
let loading: Promise<void> | null = null;
let generation = 0;
let cueVariation = 0;

function ensureContext(): AudioContext | null {
  if (!ctx || ctx.state === "closed") {
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    master.connect(limiter);
    limiter.connect(ctx.destination);
  }
  if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
  return ctx;
}

export function prepareBilliardsAudio(): Promise<void> {
  if (samples) return Promise.resolve();
  if (loading) return loading;
  const context = ensureContext();
  if (!context) return Promise.resolve();
  const currentGeneration = generation;
  loading = loadImpactSamples(context)
    .then((result) => {
      if (currentGeneration === generation) samples = result;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** 至少在用户手势中调用一次（iOS 自动播放策略）。 */
export function unlockAudio(): void {
  ensureContext();
  // 热更新后也可在下一次明确手势中恢复资源；失败不补播过期击球声。
  void prepareBilliardsAudio().catch(() => undefined);
}

/** 主音量 0..1；为 0 时直接跳过合成。 */
export function setGameAudioVolume(value: number): void {
  volume = clamp01(value);
  if (master) master.gain.value = volume;
}

function playMaterial(material: ImpactMaterial, intensity: number): void {
  if (volume <= 0) return;
  const context = ensureContext();
  if (!context || !master || !samples || context.state !== "running") return;
  const choices = samples[material];
  const buffer =
    choices[material === "cue" ? cueVariation++ % choices.length : 0];
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value =
    material === "cushion" ? 0.85 : 0.98 + Math.random() * 0.04;
  const gain = context.createGain();
  gain.gain.value =
    Math.pow(clamp01(intensity), 0.65) * (material === "cushion" ? 0.5 : 0.9);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value =
    material === "cushion" ? 700 : 6500 + clamp01(intensity) * 9500;
  filter.Q.value = 0.5;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  sources.add(source);
  source.onended = () => {
    sources.delete(source);
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
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
      playMaterial("ball", level);
      vibrate(Math.round(8 + level * 14));
      break;
    }
    case "cushion": {
      const level = loudness(event.impact) * 0.7;
      if (level < 0.03) return;
      playMaterial("cushion", level);
      break;
    }
    case "pocket": {
      playMaterial(
        "pocket",
        0.35 + 0.5 * loudness(Math.hypot(event.vx, event.vy)),
      );
      vibrate(20);
      break;
    }
  }
}

function vibrate(ms: number): void {
  const now = performance.now();
  if (now - lastVibration < 90) return;
  lastVibration = now;
  if (typeof navigator !== "undefined") navigator.vibrate?.(ms);
}

/** 杆头接触母球的干脆短音，与撞球声区分，不依赖后续是否碰球。 */
export function playCueImpact(power: number): void {
  const level = 0.18 + Math.sqrt(clamp01(power)) * 0.6;
  playMaterial("cue", level);
  vibrate(Math.round(5 + power * 10));
}

export function stopBilliardsAudio(): void {
  for (const source of sources) source.stop();
  sources.clear();
  if (typeof navigator !== "undefined") navigator.vibrate?.(0);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    generation++;
    stopBilliardsAudio();
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    ctx = null;
    master = null;
    samples = null;
    loading = null;
  });
}
