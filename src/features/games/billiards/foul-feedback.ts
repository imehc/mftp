import type { BilliardsState, FoulReason } from "./types";

export interface FoulFeedback {
  shooter: number | null;
  recipient: number | null;
  penalty: number;
  reason: FoulReason;
}

export function foulFeedback(state: BilliardsState): FoulFeedback | null {
  const outcome = state.lastOutcome;
  if (!outcome?.foul) return null;
  const shooter =
    outcome.shooter ??
    (state.variant === "snooker" && state.decision?.kind === "foul"
      ? state.decision.shooter
      : null);
  const penalty =
    state.variant === "snooker" ? (state.lastScore?.penalty ?? 0) : 0;
  return {
    shooter,
    recipient: penalty > 0 && shooter !== null ? 1 - shooter : null,
    penalty,
    reason: outcome.foul,
  };
}
