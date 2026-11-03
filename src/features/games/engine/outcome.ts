import type { SeatIndex } from "./types";

export type GameResultValue =
  | null
  | boolean
  | number
  | string
  | readonly GameResultValue[]
  | { readonly [key: string]: GameResultValue };

export type GameCompetitor =
  { kind: "seat"; seat: SeatIndex } | { kind: "team"; teamId: string };

/** 同一名次的多个参与者放在同组，避免把并列强制排成先后。 */
export interface GameRank {
  rank: number;
  competitors: readonly GameCompetitor[];
}

export type GameOutcome = (
  | { kind: "victory"; winners: readonly GameCompetitor[] }
  | { kind: "draw" }
  | { kind: "custom"; result: GameResultValue }
) & { ranking?: readonly GameRank[]; details?: GameResultValue };

/** 现有单胜者棋类保留规则字段，统一结果由游戏适配生成。 */
export function seatOutcome(
  finished: boolean,
  winner: SeatIndex | null,
): GameOutcome | null {
  if (!finished) return null;
  return winner === null
    ? { kind: "draw" }
    : { kind: "victory", winners: [{ kind: "seat", seat: winner }] };
}

/** 旧两人结果视图只投影唯一获胜座位，不猜测团队或并列的胜者。 */
export function singleWinnerSeat(
  outcome: GameOutcome | null,
): SeatIndex | null {
  if (outcome?.kind !== "victory" || outcome.winners.length !== 1) return null;
  const winner = outcome.winners[0];
  return winner.kind === "seat" ? winner.seat : null;
}
