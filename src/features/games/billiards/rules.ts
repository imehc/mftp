/**
 * 黑八规则（外加单座练习变体），作为游戏引擎的 GameDefinition。
 * 所有判定都基于确定性的 simulateShot 结果，因此 AI 评估与（将来的）
 * 远程对手会得出一致的结论。
 *
 * 相对 WPA 规则的简化（详见 docs/games.md）：无击球后必须碰库的
 * 要求、第一颗落袋的球决定组别、开球进黑八重置、自由球可在任意位置。
 */
import type {
  GameDefinition,
  MoveResolution,
  SeatIndex,
} from "../engine/types";
import {
  BALL_RADIUS,
  FOOT_SPOT_X,
  HEAD_SPOT_X,
  RACK_LAYOUT,
} from "./constants";
import { insidePlayArea, overlapsAnyBall, simulateShot } from "./physics";
import {
  ballGroup,
  remainingGroupBalls,
  type BallState,
  type BilliardsMove,
  type BilliardsPresentation,
  type BilliardsState,
  type BilliardsVariant,
  type FoulReason,
  type ShotOutcome,
} from "./types";

export function createInitialBalls(): BallState[] {
  const balls: BallState[] = [{ id: 0, x: HEAD_SPOT_X, y: 0, potted: false }];
  const spacing = BALL_RADIUS * 2 + 0.0004;
  const rowStep = (spacing * Math.sqrt(3)) / 2;
  RACK_LAYOUT.forEach((row, i) => {
    row.forEach((id, j) => {
      balls.push({
        id,
        x: FOOT_SPOT_X + i * rowStep,
        y: (j - i / 2) * spacing,
        potted: false,
      });
    });
  });
  return balls.sort((a, b) => a.id - b.id);
}

export function createInitialState(
  variant: BilliardsVariant,
  firstSeat: SeatIndex = 0,
): BilliardsState {
  return {
    variant,
    balls: createInitialBalls(),
    turnSeat: firstSeat,
    groups: variant === "practice" ? [null] : [null, null],
    openTable: true,
    breakDone: false,
    ballInHand: false,
    winnerSeat: null,
    finished: false,
    shotCount: 0,
    foulCounts: variant === "practice" ? [0] : [0, 0],
    lastOutcome: null,
  };
}

/** 重置球的第一个空位：先脚点，再沿 +x/-x 方向。 */
function findRespot(
  balls: readonly BallState[],
  ignoreId: number,
): {
  x: number;
  y: number;
} {
  const candidates: Array<[number, number]> = [[FOOT_SPOT_X, 0]];
  for (let d = 1; d <= 40; d++) {
    candidates.push([FOOT_SPOT_X + d * BALL_RADIUS, 0]);
    candidates.push([FOOT_SPOT_X - d * BALL_RADIUS, 0]);
  }
  for (const [x, y] of candidates) {
    if (insidePlayArea(x, y) && !overlapsAnyBall(balls, x, y, ignoreId)) {
      return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function respotBall(balls: BallState[], id: number): BallState[] {
  const spot = findRespot(balls, id);
  return balls.map((ball) =>
    ball.id === id ? { ...ball, x: spot.x, y: spot.y, potted: false } : ball,
  );
}

function singleFramePresentation(
  balls: readonly BallState[],
): BilliardsPresentation {
  const frame: number[] = [];
  for (const ball of balls) {
    if (!ball.potted) frame.push(ball.id, ball.x, ball.y);
  }
  return { frames: [{ t: 0, balls: frame }], events: [] };
}

function applyPlaceCue(
  state: BilliardsState,
  move: Extract<BilliardsMove, { type: "place-cue" }>,
): MoveResolution<BilliardsState, BilliardsPresentation> {
  if (!state.ballInHand) {
    throw new Error("billiards: cue ball is not in hand");
  }
  if (
    !insidePlayArea(move.x, move.y) ||
    overlapsAnyBall(state.balls, move.x, move.y, 0)
  ) {
    throw new Error("billiards: illegal cue ball placement");
  }
  const balls = state.balls.map((ball) =>
    ball.id === 0 ? { ...ball, x: move.x, y: move.y, potted: false } : ball,
  );
  const next: BilliardsState = { ...state, balls, ballInHand: false };
  return { state: next, presentation: singleFramePresentation(balls) };
}

function applyPracticeShot(
  state: BilliardsState,
  move: Extract<BilliardsMove, { type: "shot" }>,
): MoveResolution<BilliardsState, BilliardsPresentation> {
  const sim = simulateShot(state.balls, move);
  let balls = sim.balls;
  let foul: FoulReason | null = null;
  if (sim.cuePotted) {
    foul = "cue-potted";
    balls = respotCueForPractice(balls);
  }
  const finished = balls.every((ball) => ball.id === 0 || ball.potted);
  const outcome: ShotOutcome = {
    foul,
    potted: sim.pottedInOrder,
    continueTurn: true,
    respottedEight: false,
  };
  const next: BilliardsState = {
    ...state,
    balls,
    breakDone: true,
    finished,
    shotCount: state.shotCount + 1,
    foulCounts: foul !== null ? [state.foulCounts[0] + 1] : state.foulCounts,
    lastOutcome: outcome,
  };
  return {
    state: next,
    presentation: { frames: sim.frames, events: sim.events },
  };
}

function respotCueForPractice(balls: BallState[]): BallState[] {
  const candidates: Array<[number, number]> = [[HEAD_SPOT_X, 0]];
  for (let d = 1; d <= 40; d++) {
    candidates.push([HEAD_SPOT_X - d * BALL_RADIUS, 0]);
    candidates.push([HEAD_SPOT_X + d * BALL_RADIUS, 0]);
  }
  const spot =
    candidates.find(
      ([x, y]) => insidePlayArea(x, y) && !overlapsAnyBall(balls, x, y, 0),
    ) ?? candidates[0];
  return balls.map((ball) =>
    ball.id === 0 ? { ...ball, x: spot[0], y: spot[1], potted: false } : ball,
  );
}

function applyEightBallShot(
  state: BilliardsState,
  move: Extract<BilliardsMove, { type: "shot" }>,
  seat: SeatIndex,
): MoveResolution<BilliardsState, BilliardsPresentation> {
  const shooterGroup = state.groups[seat];
  const clearedBefore =
    shooterGroup !== null && remainingGroupBalls(state, shooterGroup) === 0;
  const isBreak = !state.breakDone;

  const sim = simulateShot(state.balls, move);
  const pottedNonEight = sim.pottedInOrder.filter((id) => id !== 8);
  const eightPotted = sim.pottedInOrder.includes(8);

  // 犯规判定。
  let foul: FoulReason | null = null;
  if (sim.cuePotted) {
    foul = "cue-potted";
  } else if (sim.firstContact === null) {
    foul = "no-contact";
  } else if (!isBreak) {
    const first = sim.firstContact;
    if (state.openTable) {
      if (first === 8) foul = "wrong-first-contact";
    } else if (clearedBefore) {
      if (first !== 8) foul = "wrong-first-contact";
    } else if (ballGroup(first) !== shooterGroup) {
      foul = "wrong-first-contact";
    }
  }

  let balls = sim.balls;
  let winnerSeat = state.winnerSeat;
  let finished = false;
  let respottedEight = false;

  if (eightPotted) {
    if (isBreak) {
      balls = respotBall(balls, 8);
      respottedEight = true;
    } else if (clearedBefore && foul === null) {
      winnerSeat = seat;
      finished = true;
    } else {
      // 提前或带犯规打进黑八：击球方判负。
      if (foul === null) foul = "potted-eight-early";
      winnerSeat = 1 - seat;
      finished = true;
    }
  }

  // 组别分配：开球结束后第一颗合法落袋的球决定。
  let groups = state.groups;
  let openTable = state.openTable;
  if (
    !finished &&
    !isBreak &&
    state.openTable &&
    foul === null &&
    pottedNonEight.length > 0
  ) {
    const first = ballGroup(pottedNonEight[0]);
    if (first === "solids" || first === "stripes") {
      groups = [...state.groups];
      groups[seat] = first;
      groups[1 - seat] = first === "solids" ? "stripes" : "solids";
      openTable = false;
    }
  }

  // 是否续杆。
  let continueTurn = false;
  if (!finished && foul === null) {
    if (isBreak || (openTable === true && groups[seat] === null)) {
      continueTurn = pottedNonEight.length > 0;
    } else {
      const own = groups[seat];
      continueTurn =
        own !== null && pottedNonEight.some((id) => ballGroup(id) === own);
    }
  }

  const outcome: ShotOutcome = {
    foul,
    potted: sim.pottedInOrder,
    continueTurn,
    respottedEight,
  };
  const next: BilliardsState = {
    ...state,
    balls,
    turnSeat: finished || continueTurn ? state.turnSeat : 1 - seat,
    groups,
    openTable,
    breakDone: true,
    ballInHand: !finished && foul !== null,
    winnerSeat,
    finished,
    shotCount: state.shotCount + 1,
    foulCounts:
      foul !== null
        ? state.foulCounts.map((count, i) => (i === seat ? count + 1 : count))
        : state.foulCounts,
    lastOutcome: outcome,
  };
  return {
    state: next,
    presentation: { frames: sim.frames, events: sim.events },
  };
}

export function createBilliardsGame(
  variant: BilliardsVariant,
): GameDefinition<BilliardsState, BilliardsMove, BilliardsPresentation> {
  return {
    id: variant === "practice" ? "billiards-practice" : "billiards-8ball",
    seatCount: variant === "practice" ? 1 : 2,
    currentSeat: (state) => (state.finished ? null : state.turnSeat),
    winnerSeat: (state) => state.winnerSeat,
    isFinished: (state) => state.finished,
    applyMove: (state, move, seat) => {
      if (state.finished) throw new Error("billiards: match already finished");
      if (seat !== state.turnSeat) {
        throw new Error("billiards: move from inactive seat");
      }
      if (move.type === "place-cue") return applyPlaceCue(state, move);
      if (state.ballInHand) {
        throw new Error("billiards: place the cue ball first");
      }
      return state.variant === "practice"
        ? applyPracticeShot(state, move)
        : applyEightBallShot(state, move, seat);
    },
  };
}
