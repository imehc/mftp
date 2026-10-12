/** 斯诺克客观计分与自动漏击策略；球位恢复不回滚已经记入的罚分。 */
import { createRng } from "../engine/ai";
import type { ShotSimResult } from "./physics";
import {
  BAULK_X,
  COLOR_IDS,
  createSnookerRack,
  D_RADIUS,
  isRed,
  snookerValue,
} from "./snooker-equipment";
import { respotColors } from "./snooker-respot";
import {
  ballsOn,
  freeBallAvailable,
  snookeredBy,
  snookerVisibility,
} from "./snooker-visibility";
import type {
  BilliardsMove,
  FoulReason,
  RedCount,
  SnookerOn,
  SnookerPosition,
  SnookerState,
} from "./types";

export function createSnookerState(
  reds: RedCount,
  firstSeat = 0,
  seed = 1,
): SnookerState {
  return {
    variant: "snooker",
    reds,
    frameSeed: seed,
    balls: createSnookerRack(reds, seed),
    turnSeat: firstSeat,
    on: { kind: "red" },
    placementRegion: "d",
    ballInHand: false,
    breakDone: false,
    winnerSeat: null,
    finished: false,
    shotCount: 0,
    foulCounts: [0, 0],
    lastOutcome: null,
    scores: [0, 0],
    currentBreak: 0,
    highestBreaks: [0, 0],
    decision: null,
    freeBall: false,
    nominatedFree: null,
    missRun: null,
    lastScore: null,
    respottedBlack: false,
  };
}

export const snookerSeat = (state: SnookerState) =>
  state.decision?.kind === "foul" && state.decision.warning
    ? state.decision.shooter
    : (state.decision?.seat ?? state.turnSeat);

export function onValue(on: SnookerOn): number {
  return on.kind === "red"
    ? 1
    : on.kind === "color"
      ? (on.nominated ?? 4)
      : on.color;
}

export function availablePoints(
  state: Pick<SnookerState, "balls" | "on">,
): number {
  const reds = state.balls.filter(
    (ball) => !ball.potted && isRed(ball.id),
  ).length;
  if (reds || state.on.kind !== "clearance")
    return reds * 8 + (state.on.kind === "color" ? 7 : 0) + 27;
  return state.balls
    .filter((ball) => !ball.potted && ball.id !== 0)
    .reduce((sum, ball) => sum + snookerValue(ball.id), 0);
}

export function needsPenaltyPoints(
  state: Pick<SnookerState, "balls" | "on" | "scores">,
): boolean {
  return Math.abs(state.scores[0] - state.scores[1]) > availablePoints(state);
}

function nextOn(
  state: SnookerState,
  balls: SnookerState["balls"],
  scored: boolean,
  foul: boolean,
  cleared: boolean,
): SnookerOn {
  const redsLeft = balls.some((ball) => !ball.potted && isRed(ball.id));
  if (state.on.kind === "red")
    return scored && !foul
      ? { kind: "color", nominated: null }
      : redsLeft
        ? { kind: "red" }
        : { kind: "clearance", color: 2 };
  if (state.on.kind === "color")
    return redsLeft ? { kind: "red" } : { kind: "clearance", color: 2 };
  return {
    kind: "clearance",
    color: state.on.color + (cleared && !foul ? 1 : 0),
  };
}

function finishBlack(state: SnookerState): SnookerState {
  if (state.scores[0] !== state.scores[1])
    return {
      ...state,
      finished: true,
      winnerSeat: state.scores[0] > state.scores[1] ? 0 : 1,
      decision: null,
      placementRegion: null,
      ballInHand: false,
    };
  const drawSeat = createRng(state.frameSeed ^ state.shotCount)() < 0.5 ? 0 : 1;
  const balls = respotColors(state.balls, [7]).map((ball) =>
    ball.id === 0
      ? { ...ball, x: BAULK_X - D_RADIUS / 2, y: 0, potted: true }
      : ball,
  );
  return {
    ...state,
    balls,
    on: { kind: "clearance", color: 7 },
    respottedBlack: true,
    decision: { kind: "black-choice", seat: drawSeat },
    placementRegion: "d",
    ballInHand: true,
    currentBreak: 0,
    freeBall: false,
    nominatedFree: null,
    missRun: null,
  };
}

export function reduceSnookerShot(
  state: SnookerState,
  sim: ShotSimResult,
  move: Extract<BilliardsMove, { type: "shot" }>,
): SnookerState {
  if (
    state.finished ||
    state.decision ||
    (state.on.kind === "color" && state.on.nominated === null)
  )
    throw new Error("billiards: snooker shot is not ready");
  const shooter = state.turnSeat,
    opponent = 1 - shooter;
  const targets = ballsOn(state.balls, state.on);
  const free = state.nominatedFree;
  const legalFirst = free !== null ? [free, ...targets] : targets;
  const cue = state.balls.find((ball) => ball.id === 0);
  const touchingOn = sim.facts.touchingCue.filter((id) =>
    legalFirst.includes(id),
  );
  const playedAway =
    touchingOn.length > 0 &&
    touchingOn.every((id) => {
      const ball = state.balls.find((b) => b.id === id);
      return (
        cue &&
        ball &&
        (ball.x - cue.x) * Math.cos(move.angle) +
          (ball.y - cue.y) * Math.sin(move.angle) <=
          1e-9
      );
    });
  const pushedIds = sim.facts.touchingCue.filter((id) => {
    const ball = state.balls.find((b) => b.id === id);
    return (
      cue &&
      ball &&
      (ball.x - cue.x) * Math.cos(move.angle) +
        (ball.y - cue.y) * Math.sin(move.angle) >
        1e-9
    );
  });
  const pushedTouching = pushedIds.length > 0;
  const first = sim.facts.firstContacts;
  const hitOn =
    (playedAway && (free === null || touchingOn.includes(free))) ||
    (first.length > 0 &&
      first.every((id) => legalFirst.includes(id)) &&
      (free === null || first.includes(free)));
  let foul: FoulReason | null = sim.cuePotted
    ? "cue-potted"
    : pushedTouching
      ? "touching-ball-moved"
      : !first.length && !playedAway
        ? "no-contact"
        : !hitOn
          ? "wrong-first-contact"
          : null;
  const allowedPots = [...targets, ...(free !== null ? [free] : [])];
  if (!foul && sim.pottedInOrder.some((id) => !allowedPots.includes(id)))
    foul = "wrong-ball-potted";
  const realPotted = sim.pottedInOrder.filter((id) => targets.includes(id));
  const freePotted = free !== null && sim.pottedInOrder.includes(free);
  let points =
    state.on.kind === "red"
      ? realPotted.length + (freePotted ? 1 : 0)
      : realPotted.length || freePotted
        ? onValue(state.on)
        : 0;
  // 清彩时实际ball-on进袋才移到下一彩球；自由球本身必须复位。
  const cleared =
    state.on.kind === "clearance" && realPotted.includes(state.on.color);
  const respot = sim.pottedInOrder.filter(
    (id) =>
      !isRed(id) && (foul || state.on.kind !== "clearance" || id === free),
  );
  let balls = respotColors(sim.balls, respot);
  if (freePotted && free !== null && isRed(free)) {
    // 清彩阶段没有红球可提名；红球阶段实际红球本来就是ball-on，故不会进入此分支。
    throw new Error("billiards: invalid red free-ball nomination");
  }
  let on = nextOn(state, balls, points > 0, foul !== null, cleared);
  const afterSight = { balls, on };
  const twoObjectBalls =
    balls.filter((ball) => ball.id !== 0 && !ball.potted).length === 2;
  if (
    !foul &&
    points === 0 &&
    free !== null &&
    !twoObjectBalls &&
    snookeredBy(afterSight, free)
  )
    foul = "snooker-behind-nomination";
  if (
    !foul &&
    points === 0 &&
    state.reds === 6 &&
    state.on.kind === "color" &&
    state.on.nominated !== null &&
    snookeredBy(afterSight, state.on.nominated)
  )
    foul = "snooker-behind-nomination";
  if (foul) {
    points = 0;
    // 障碍犯规可能在第一次复位后判定；统一再次按犯规恢复所有彩球。
    const foulColors = sim.pottedInOrder.filter((id) =>
      COLOR_IDS.includes(id as (typeof COLOR_IDS)[number]),
    );
    balls = respotColors(sim.balls, foulColors);
    on = nextOn(state, balls, false, true, false);
  }
  const penalty = foul
    ? Math.min(
        7,
        Math.max(
          4,
          onValue(state.on),
          ...first
            .filter(
              (id) =>
                !legalFirst.includes(id) ||
                (free !== null && !first.includes(free)),
            )
            .map(snookerValue),
          ...pushedIds.map((id) =>
            id === free ? onValue(state.on) : snookerValue(id),
          ),
          ...sim.pottedInOrder
            .filter((id) => !allowedPots.includes(id))
            .map(snookerValue),
        ),
      )
    : 0;
  const scores = state.scores.map(
    (score, seat) => score + (seat === shooter ? points : penalty),
  );
  // 进红后的任一彩球都可以重新指定；MISS的可达性必须覆盖可选目标。
  const sight =
    state.on.kind === "color"
      ? COLOR_IDS.reduce(
          (visible, color) => {
            const current = snookerVisibility({
              balls: state.balls,
              on: { kind: "clearance", color },
            });
            return {
              any: visible.any || current.any,
              full: visible.full || current.full,
            };
          },
          { any: false, full: false },
        )
      : snookerVisibility(
          free === null
            ? state
            : { balls: state.balls, on: { kind: "clearance", color: free } },
        );
  const oldRun = state.missRun?.shooter === shooter ? state.missRun : null;
  const fullBallSequence =
    !!oldRun && oldRun.fullBallFailures > 0 && sight.full;
  // 只对存在明确直达路径的未击中球作自动MISS；被完全做障碍后不代替真人判断尽力程度。
  const miss =
    !!foul &&
    !hitOn &&
    sight.any &&
    (fullBallSequence ||
      (!needsPenaltyPoints(state) &&
        !needsPenaltyPoints({ balls, on, scores })));
  const missRun = miss
    ? {
        shooter,
        count: (oldRun?.count ?? 0) + 1,
        fullBallFailures: sight.full ? (oldRun?.fullBallFailures ?? 0) + 1 : 0,
        warned: oldRun?.warned ?? false,
        sixWarned: oldRun?.sixWarned ?? false,
      }
    : null;
  const thirdMissLoss =
    !!missRun && sight.full && missRun.fullBallFailures >= 3 && missRun.warned;
  let warning: "three-miss" | "six-red" | null = null;
  if (missRun && state.reds === 6 && missRun.count === 4) warning = "six-red";
  const anywhere =
    !!missRun &&
    state.reds === 6 &&
    missRun.count >= 5 &&
    missRun.sixWarned &&
    !needsPenaltyPoints(state) &&
    !needsPenaltyPoints({ balls, on, scores });
  const saved: SnookerPosition = {
    balls: state.balls,
    on: state.on,
    placementRegion: state.placementRegion,
    freeBall: state.freeBall,
    nominatedFree: state.nominatedFree,
  };
  const placementRegion = sim.cuePotted ? "d" : null;
  const continueTurn = !foul && points > 0;
  const currentBreak = continueTurn ? state.currentBreak + points : 0;
  let next: SnookerState = {
    ...state,
    balls,
    on,
    scores,
    currentBreak,
    highestBreaks: state.highestBreaks.map((best, seat) =>
      seat === shooter ? Math.max(best, currentBreak) : best,
    ),
    turnSeat: continueTurn ? shooter : opponent,
    breakDone: true,
    shotCount: state.shotCount + 1,
    placementRegion,
    ballInHand: sim.cuePotted,
    freeBall: false,
    nominatedFree: null,
    foulCounts: state.foulCounts.map(
      (count, seat) => count + (foul && seat === shooter ? 1 : 0),
    ),
    lastOutcome: {
      foul,
      potted: sim.pottedInOrder,
      continueTurn,
      respottedEight: false,
    },
    lastScore: {
      points,
      penalty,
      miss,
      respotted: foul ? sim.pottedInOrder.filter((id) => !isRed(id)) : respot,
    },
    missRun,
    decision: foul
      ? {
          kind: "foul",
          seat: opponent,
          shooter,
          replace:
            miss && !(state.reds === 6 && (missRun?.count ?? 0) >= 5)
              ? saved
              : null,
          anywhere,
          warning,
        }
      : null,
  };
  if (thirdMissLoss)
    return { ...next, finished: true, winnerSeat: opponent, decision: null };
  const onlyBlackBefore = state.on.kind === "clearance" && state.on.color === 7;
  if (onlyBlackBefore && (foul || points > 0)) return finishBlack(next);
  if (foul) next = { ...next, freeBall: freeBallAvailable(next) };
  return next;
}
