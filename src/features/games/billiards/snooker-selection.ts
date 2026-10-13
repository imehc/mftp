import { COLOR_IDS } from "./snooker-equipment";
import { ballsOn } from "./snooker-visibility";
import type { SnookerState } from "./types";

export function snookerSelection(state: SnookerState) {
  const on = ballsOn(state.balls, state.on);
  return {
    colors: state.on.kind === "color" ? COLOR_IDS : [],
    free: state.freeBall
      ? state.balls
          .filter((ball) => ball.id && !ball.potted && !on.includes(ball.id))
          .map((ball) => ball.id)
      : [],
    editable:
      !state.finished &&
      !state.decision &&
      (state.on.kind === "color" || state.freeBall),
  };
}
