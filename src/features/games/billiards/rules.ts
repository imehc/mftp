/**
 * 黑八规则（外加单座练习变体），作为游戏引擎的 GameDefinition。
 * 所有判定都基于确定性的 simulateShot 结果，因此 AI 评估与（将来的）
 * 远程对手会得出一致的结论。
 *
 * 相对 WPA 规则的简化（详见 docs/games.md）：无击球后必须碰库的
 * 要求、第一颗落袋的球决定组别、开球进黑八重置、自由球可在任意位置。
 */
import { createRng } from "../engine/ai";
import type {
  GameDefinition,
  MoveResolution,
  SeatIndex,
} from "../engine/types";
import { BALL_RADIUS, FOOT_SPOT_X, HEAD_SPOT_X } from "./constants";
import {
  applyNineBallAction,
  nineBallSeat,
  reduceNineBallShot,
  validateNineShot,
} from "./nine-ball";
import { insidePlayArea, overlapsAnyBall, simulateShot } from "./physics";
import { equipmentForState, nearestLineSpot } from "./placement";
import { createNineBallRack } from "./racks";
import type { ShotSimulator } from "./simulation-client";
import { reduceSnookerShot, snookerSeat } from "./snooker";
import { applySnookerAction, validateSnookerShot } from "./snooker-actions";
import { createSnookerRack } from "./snooker-equipment";
import {
  ballGroup,
  type BallState,
  type BilliardsDiscipline,
  type BilliardsMove,
  type BilliardsPresentation,
  type BilliardsState,
  type BilliardsVariant,
  type EightBallState,
  type FoulReason,
  type RedCount,
  remainingGroupBalls,
  type ShotOutcome,
} from "./types";

/**
 * 黑八摆球：8 号固定在第三排中间，最后一排两个底角必须一颗全色、一颗
 * 花色（左右随机），其余球按种子随机。种子在对局创建时固定，重赛可复现。
 */
export function createInitialBalls(seed = 1): BallState[] {
  const balls: BallState[] = [{ id: 0, x: HEAD_SPOT_X, y: 0, potted: false }];
  const spacing = BALL_RADIUS * 2 + 0.0004;
  const rowStep = (spacing * Math.sqrt(3)) / 2;
  const rng = createRng(seed);

  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };

  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  // 先抽出底角的一全一花，再把剩余 12 颗混在一起填其余位置。
  const corners = shuffle([solids.pop()!, stripes.pop()!]);
  const rest = shuffle([...solids, ...stripes]);
  const rows = [1, 2, 3, 4, 5];
  rows.forEach((count, i) => {
    for (let j = 0; j < count; j++) {
      const bottom = i === rows.length - 1;
      const id =
        i === 2 && j === 1
          ? 8
          : bottom && (j === 0 || j === count - 1)
            ? corners[j === 0 ? 0 : 1]
            : rest.pop()!;
      balls.push({
        id,
        x: FOOT_SPOT_X + i * rowStep,
        y: (j - i / 2) * spacing,
        potted: false,
      });
    }
  });
  return balls.sort((a, b) => a.id - b.id);
}

export function createInitialState(
  variant: "eight-ball" | "practice",
  firstSeat: SeatIndex = 0,
  discipline: BilliardsDiscipline = "eight-ball",
  seed = 1,
  reds: RedCount = 15,
): EightBallState {
  return {
    variant,
    balls:
      discipline === "nine-ball"
        ? createNineBallRack(seed)
        : discipline === "snooker"
          ? createSnookerRack(reds, seed)
          : createInitialBalls(seed),
    discipline,
    reds: discipline === "snooker" ? reds : undefined,
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
  state: EightBallState,
  move: Extract<BilliardsMove, { type: "place-cue" }>,
): MoveResolution<EightBallState, BilliardsPresentation> {
  if (!state.ballInHand) {
    throw new Error("billiards: cue ball is not in hand");
  }
  if (
    !insidePlayArea(move.x, move.y, equipmentForState(state)) ||
    overlapsAnyBall(state.balls, move.x, move.y, 0, equipmentForState(state))
  ) {
    throw new Error("billiards: illegal cue ball placement");
  }
  const balls = state.balls.map((ball) =>
    ball.id === 0 ? { ...ball, x: move.x, y: move.y, potted: false } : ball,
  );
  const next: EightBallState = { ...state, balls, ballInHand: false };
  return { state: next, presentation: singleFramePresentation(balls) };
}

async function applyPracticeShot(
  state: EightBallState,
  move: Extract<BilliardsMove, { type: "shot" }>,
  simulate: ShotSimulator,
): Promise<MoveResolution<EightBallState, BilliardsPresentation>> {
  const sim = await simulate(state.balls, move);
  let balls = sim.balls;
  let foul: FoulReason | null = null;
  if (sim.cuePotted) {
    foul = "cue-potted";
    balls = respotCueForPractice(balls, state);
  }
  const finished = balls.every((ball) => ball.id === 0 || ball.potted);
  const outcome: ShotOutcome = {
    shooter: state.turnSeat,
    foul,
    potted: sim.pottedInOrder,
    continueTurn: true,
    respottedEight: false,
  };
  const next: EightBallState = {
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

function respotCueForPractice(
  balls: BallState[],
  state: EightBallState,
): BallState[] {
  const equipment = equipmentForState(state);
  const limit = equipment.tableWidth / 2 - equipment.ballRadius;
  const spot =
    nearestLineSpot(
      balls,
      0,
      -equipment.tableWidth / 4,
      -limit,
      0,
      equipment,
      () => 0.0001,
    ) ??
    nearestLineSpot(
      balls,
      0,
      -equipment.tableWidth / 4,
      limit,
      0,
      equipment,
      () => 0.0001,
    );
  if (!spot) throw new Error("billiards: no legal practice cue spot");
  return balls.map((ball) =>
    ball.id === 0 ? { ...ball, ...spot, potted: false } : ball,
  );
}

async function applyEightBallShot(
  state: EightBallState,
  move: Extract<BilliardsMove, { type: "shot" }>,
  seat: SeatIndex,
  simulate: ShotSimulator,
): Promise<MoveResolution<EightBallState, BilliardsPresentation>> {
  const shooterGroup = state.groups[seat];
  const clearedBefore =
    shooterGroup !== null && remainingGroupBalls(state, shooterGroup) === 0;
  const isBreak = !state.breakDone;

  const sim = await simulate(state.balls, move);
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
    shooter: seat,
    foul,
    potted: sim.pottedInOrder,
    continueTurn,
    respottedEight,
  };
  const next: EightBallState = {
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
  simulate?: ShotSimulator,
): GameDefinition<BilliardsState, BilliardsMove, BilliardsPresentation> {
  return {
    id: `billiards-${variant}`,
    seatCount: variant === "practice" ? 1 : 2,
    currentSeat: (state) =>
      state.finished
        ? null
        : state.variant === "nine-ball"
          ? nineBallSeat(state)
          : state.variant === "snooker"
            ? snookerSeat(state)
            : state.turnSeat,
    winnerSeat: (state) => state.winnerSeat,
    isFinished: (state) => state.finished,
    applyMove: async (state, move, seat) => {
      const simulateForState: ShotSimulator =
        simulate ??
        ((balls, shot) =>
          simulateShot(balls, shot, false, equipmentForState(state)));
      if (state.finished) throw new Error("billiards: match already finished");
      if (
        seat !==
        (state.variant === "nine-ball"
          ? nineBallSeat(state)
          : state.variant === "snooker"
            ? snookerSeat(state)
            : state.turnSeat)
      ) {
        throw new Error("billiards: move from inactive seat");
      }
      if (state.variant === "snooker") {
        if (move.type !== "shot") {
          const next = applySnookerAction(state, move);
          return {
            state: next,
            presentation: singleFramePresentation(next.balls),
          };
        }
        validateSnookerShot(state, move);
        const sim = await simulateForState(state.balls, move);
        return {
          state: reduceSnookerShot(state, sim, move),
          presentation: { frames: sim.frames, events: sim.events },
        };
      }
      if (state.variant === "nine-ball") {
        if (move.type !== "shot") {
          const next = applyNineBallAction(state, move);
          return {
            state: next,
            presentation: singleFramePresentation(next.balls),
          };
        }
        validateNineShot(state, move);
        const sim = await simulateForState(state.balls, move);
        return {
          state: reduceNineBallShot(state, sim, move.pushOut),
          presentation: { frames: sim.frames, events: sim.events },
        };
      }
      if (move.type === "place-cue") return applyPlaceCue(state, move);
      if (move.type !== "shot" || move.pushOut)
        throw new Error("billiards: unsupported action");
      if (state.ballInHand) {
        throw new Error("billiards: place the cue ball first");
      }
      return state.variant === "practice"
        ? applyPracticeShot(state, move, simulateForState)
        : applyEightBallShot(state, move, seat, simulateForState);
    },
  };
}
