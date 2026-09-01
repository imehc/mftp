/**
 * 各游戏共用的 AI 抽象：游戏提供 `AiStrategy`（如何搜索走法）；
 * 框架统一难度档位，并把策略转成 `PlayerController`（见
 * controllers.ts 的 AiController）。
 */
import type { SeatIndex } from "./types";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface AiStrategy<S, M> {
  /**
   * 为 `seat` 选择走法。实现应遵守 `signal`（中止时退出），并在
   * 长时间搜索期间让出 UI 线程（见 `yieldToUi`）。
   */
  chooseMove(
    state: S,
    seat: SeatIndex,
    difficulty: Difficulty,
    signal: AbortSignal,
  ): Promise<M>;
}

/** 协作式让出，使繁重的搜索不冻结渲染。 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 确定性伪随机数（mulberry32）。AI 的随机性不能用 Math.random：
 * 以对局 / 回合派生种子后，远端重放相同输入能保持一致，且
 * 缺陷报告也能复现。
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由给定均匀分布 RNG 经 Box-Muller 生成的标准正态分布。 */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
