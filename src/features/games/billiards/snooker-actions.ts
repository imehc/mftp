import { legalCuePlacement } from "./placement";
import { snookerSeat } from "./snooker";
import { COLOR_IDS } from "./snooker-equipment";
import { ballsOn } from "./snooker-visibility";
import type { BilliardsMove, SnookerState } from "./types";

export function validateSnookerShot(
  state: SnookerState,
  move: Extract<BilliardsMove, { type: "shot" }>,
): void {
  if (state.decision || state.ballInHand || move.pushOut)
    throw new Error("billiards: snooker shot unavailable");
  if (state.on.kind === "color" && state.on.nominated === null)
    throw new Error("billiards: nominate a colour first");
  const cue = state.balls.find((ball) => ball.id === 0 && !ball.potted);
  if (
    !cue ||
    (state.placementRegion && !legalCuePlacement(state, cue.x, cue.y))
  )
    throw new Error("billiards: illegal snooker cue placement");
}

export function applySnookerAction(
  state: SnookerState,
  move: Exclude<BilliardsMove, { type: "shot" }>,
): SnookerState {
  if (move.type === "concede")
    return {
      ...state,
      finished: true,
      winnerSeat: 1 - snookerSeat(state),
      decision: null,
    };
  const decision = state.decision;
  if (decision) {
    if (move.type !== "decision")
      throw new Error("billiards: snooker decision required");
    if (
      decision.kind === "black-choice" &&
      (move.choice === "accept" || move.choice === "return")
    )
      return {
        ...state,
        decision: null,
        turnSeat: move.choice === "accept" ? decision.seat : 1 - decision.seat,
      };
    if (decision.kind === "foul") {
      if (decision.warning) {
        if (move.choice !== "acknowledge")
          throw new Error("billiards: miss warning must be acknowledged");
        const acknowledged = {
          ...state,
          decision: { ...decision, warning: null },
          missRun: state.missRun
            ? {
                ...state.missRun,
                warned:
                  state.missRun.warned || decision.warning === "three-miss",
                sixWarned:
                  state.missRun.sixWarned || decision.warning === "six-red",
              }
            : null,
        };
        return decision.warning === "three-miss"
          ? applySnookerAction(acknowledged, {
              type: "decision",
              choice: "replace",
            })
          : acknowledged;
      }
      if (move.choice === "accept")
        return {
          ...state,
          decision: null,
          missRun: null,
          turnSeat: decision.seat,
        };
      if (move.choice === "return")
        return {
          ...state,
          decision: null,
          missRun: null,
          turnSeat: decision.shooter,
          freeBall: false,
          nominatedFree: null,
        };
      if (move.choice === "replace" && decision.replace) {
        if (
          state.missRun &&
          state.missRun.fullBallFailures >= 2 &&
          !state.missRun.warned
        )
          return { ...state, decision: { ...decision, warning: "three-miss" } };
        return {
          ...state,
          ...decision.replace,
          on:
            decision.replace.on.kind === "color"
              ? { kind: "color", nominated: null }
              : decision.replace.on,
          decision: null,
          turnSeat: decision.shooter,
          ballInHand: decision.replace.balls.some(
            (ball) => ball.id === 0 && ball.potted,
          ),
          currentBreak: 0,
        };
      }
      if (move.choice === "anywhere" && decision.anywhere)
        return {
          ...state,
          decision: null,
          missRun: null,
          turnSeat: decision.seat,
          placementRegion: "table",
          ballInHand: true,
          freeBall: false,
          nominatedFree: null,
        };
    }
    throw new Error("billiards: invalid snooker decision");
  }
  if (
    move.type === "claim-frame" &&
    state.on.kind === "clearance" &&
    state.on.color === 7 &&
    Math.abs(state.scores[0] - state.scores[1]) > 7
  )
    return {
      ...state,
      finished: true,
      winnerSeat: state.scores[0] > state.scores[1] ? 0 : 1,
    };
  if (move.type === "reposition-cue" && state.placementRegion)
    return { ...state, ballInHand: true };
  if (
    move.type === "place-cue" &&
    state.placementRegion &&
    legalCuePlacement(state, move.x, move.y)
  )
    return {
      ...state,
      ballInHand: false,
      balls: state.balls.map((ball) =>
        ball.id === 0 ? { ...ball, x: move.x, y: move.y, potted: false } : ball,
      ),
    };
  if (
    move.type === "nominate" &&
    state.on.kind === "color" &&
    COLOR_IDS.some((id) => id === move.ballId)
  )
    return {
      ...state,
      on: { kind: "color", nominated: move.ballId },
      nominatedFree: null,
    };
  if (move.type === "nominate-free" && state.freeBall) {
    const valid =
      move.ballId === null ||
      state.balls.some(
        (ball) =>
          ball.id === move.ballId &&
          ball.id !== 0 &&
          !ball.potted &&
          !ballsOn(state.balls, state.on).includes(ball.id),
      );
    if (valid) return { ...state, nominatedFree: move.ballId };
  }
  throw new Error("billiards: invalid snooker action");
}
