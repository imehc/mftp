import type { MatchSnapshot } from "../engine/match";
import type { ReversiSession, ReversiState } from "./types";

/** 将对局快照作为显式依赖，避免编译器缓存稳定 runner 上的历史读取。 */
export function matchUndoPlies(
  runner: ReversiSession["runner"],
  snapshot: MatchSnapshot<ReversiState>,
  localSeat?: number,
): number {
  if (snapshot.phase !== "awaiting-move") return 0;
  return undoPliesFor(runner.getCheckpoint(), localSeat);
}

/** 自动跳过后可连续落子，必须查真实落子方，不能按奇偶数回退。 */
export function undoPliesFor(
  history: readonly ReversiState[],
  localSeat?: number,
): number {
  if (history.length < 2 || history.at(-1)?.finished) return 0;
  if (localSeat === undefined) return 1;
  for (let index = history.length - 1; index > 0; index--) {
    if (history[index].lastMove?.seat === localSeat)
      return history.length - index;
  }
  return 0;
}
