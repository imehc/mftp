/**
 * AI abstraction shared by all games: a game supplies an `AiStrategy`
 * (how to search for a move); the framework standardizes difficulty
 * levels and turns a strategy into a `PlayerController` (see
 * controllers.ts AiController).
 */
import type { SeatIndex } from "./types";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface AiStrategy<S, M> {
  /**
   * Pick a move for `seat`. Implementations should honor `signal`
   * (bail out when aborted) and yield to the UI thread during long
   * searches (see `yieldToUi`).
   */
  chooseMove(
    state: S,
    seat: SeatIndex,
    difficulty: Difficulty,
    signal: AbortSignal,
  ): Promise<M>;
}

/** Cooperative yield so heavy searches don't freeze rendering. */
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
 * Deterministic PRNG (mulberry32). AI noise must not use Math.random:
 * with a seed derived from match/turn, remote peers replaying the same
 * inputs stay in lockstep, and bug reports become reproducible.
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

/** Standard normal via Box-Muller, driven by the given uniform RNG. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
