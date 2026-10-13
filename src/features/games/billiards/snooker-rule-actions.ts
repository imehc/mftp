import type { SnookerState } from "./types";

export function snookerRuleActions(state: SnookerState) {
  return {
    decision: !state.finished && state.decision !== null,
    reposition:
      !state.finished && !state.ballInHand && state.placementRegion !== null,
    claim:
      !state.finished &&
      state.on.kind === "clearance" &&
      state.on.color === 7 &&
      Math.abs(state.scores[0] - state.scores[1]) > 7,
  };
}
