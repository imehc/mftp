/** 九球裁判只消费事实；推杆/违规开球后的决定拥有独立控制座位。 */
import type { ShotSimResult } from "./physics";
import { legalCuePlacement, respotNine } from "./placement";
import { createNineBallRack } from "./racks";
import type { BilliardsMove, FoulReason, NineBallState } from "./types";

export function createNineBallState(
  firstSeat = 0,
  rackSeed = 1,
): NineBallState {
  return {
    variant: "nine-ball",
    balls: createNineBallRack(rackSeed),
    turnSeat: firstSeat,
    breaker: firstSeat,
    rackSeed,
    breakDone: false,
    ballInHand: false,
    placementRegion: "head",
    pushOutAvailable: false,
    decision: null,
    consecutiveFouls: [0, 0],
    warned: [false, false],
    winnerSeat: null,
    finished: false,
    shotCount: 0,
    foulCounts: [0, 0],
    lastOutcome: null,
  };
}

export function nineBallSeat(state: NineBallState): number {
  return state.decision?.seat ?? state.turnSeat;
}

export function lowestBall(state: NineBallState): number | null {
  const ids = state.balls
    .filter((ball) => ball.id !== 0 && !ball.potted)
    .map((ball) => ball.id);
  return ids.length ? Math.min(...ids) : null;
}

export function validateNineShot(
  state: NineBallState,
  move: Extract<BilliardsMove, { type: "shot" }>,
): void {
  if (state.decision) throw new Error("billiards: decision required");
  if (state.ballInHand) throw new Error("billiards: place the cue ball first");
  if (move.pushOut && !state.pushOutAvailable)
    throw new Error("billiards: push-out unavailable");
  const cue = state.balls.find((ball) => ball.id === 0 && !ball.potted);
  if (
    !cue ||
    (state.placementRegion && !legalCuePlacement(state, cue.x, cue.y))
  )
    throw new Error("billiards: illegal cue ball placement");
}

export function reduceNineBallShot(
  state: NineBallState,
  sim: ShotSimResult,
  pushOut = false,
): NineBallState {
  if (state.finished || state.decision || (pushOut && !state.pushOutAvailable))
    throw new Error("billiards: invalid nine-ball shot state");
  const shooter = state.turnSeat;
  const opponent = 1 - shooter;
  const isBreak = !state.breakDone;
  const potted = sim.pottedInOrder;
  const firstTime = sim.facts.firstContactTime;
  const railsAfter = sim.facts.rails.filter(
    (contact) => firstTime !== null && contact.t + 1e-6 >= firstTime,
  );
  let foul: FoulReason | null = null;
  if (sim.cuePotted) foul = "cue-potted";
  else if (!pushOut) {
    if (!sim.facts.firstContacts.length) foul = "no-contact";
    else if (!sim.facts.firstContacts.includes(lowestBall(state)!))
      foul = "wrong-first-contact";
    else if (
      !potted.length &&
      isBreak &&
      new Set(railsAfter.filter((c) => c.ball !== 0).map((c) => c.ball)).size <
        4
    )
      foul = "illegal-break";
    else if (!potted.length && !railsAfter.length) foul = "no-rail";
  }
  // 落袋与越线分别贡献数量；同球反复越线在物理事实层已去重。
  const illegalBreak =
    isBreak &&
    foul === null &&
    potted.length + new Set(sim.facts.crossedHeadString).size < 3;
  const ninePotted = potted.includes(9);
  const respottedNine =
    ninePotted && (foul !== null || pushOut || illegalBreak);
  const consecutiveFouls = state.consecutiveFouls.map((count, seat) =>
    seat === shooter ? (foul ? count + 1 : 0) : count,
  );
  const thirdFoul =
    foul !== null && consecutiveFouls[shooter] >= 3 && state.warned[shooter];
  const winnerSeat = thirdFoul
    ? opponent
    : ninePotted && !respottedNine
      ? shooter
      : null;
  const finished = winnerSeat !== null;
  const continueTurn =
    !finished &&
    foul === null &&
    !pushOut &&
    !illegalBreak &&
    potted.length > 0;
  const warned = state.warned.map((value, seat) =>
    seat === shooter && !foul ? false : value,
  );
  const next: NineBallState = {
    ...state,
    balls: respottedNine ? respotNine(sim.balls) : sim.balls,
    turnSeat: continueTurn ? shooter : opponent,
    winnerSeat,
    finished,
    breakDone: true,
    shotCount: state.shotCount + 1,
    ballInHand: !finished && foul !== null,
    placementRegion: !finished && foul !== null ? "table" : null,
    pushOutAvailable: !finished && isBreak && !foul && !illegalBreak,
    consecutiveFouls,
    warned,
    foulCounts: state.foulCounts.map(
      (count, seat) => count + (seat === shooter && foul ? 1 : 0),
    ),
    lastOutcome: {
      shooter,
      foul,
      potted,
      continueTurn,
      respottedEight: false,
      respottedNine,
    },
    decision: finished
      ? null
      : illegalBreak
        ? { kind: "illegal-break", seat: opponent, shooter }
        : !foul && pushOut
          ? { kind: "push-out", seat: opponent, shooter }
          : foul && consecutiveFouls[shooter] >= 2 && !warned[shooter]
            ? { kind: "warning", seat: shooter }
            : null,
  };
  return next;
}

export function applyNineBallAction(
  state: NineBallState,
  move: Exclude<BilliardsMove, { type: "shot" }>,
): NineBallState {
  const decision = state.decision;
  if (decision) {
    if (move.type !== "decision")
      throw new Error("billiards: decision required");
    if (decision.kind === "warning" && move.choice === "acknowledge")
      return {
        ...state,
        decision: null,
        warned: state.warned.map((v, i) => i === decision.seat || v),
      };
    if (decision.kind === "stalemate") {
      if (move.choice === "decline") return { ...state, decision: null };
      if (move.choice === "rerack")
        return createNineBallState(state.breaker, state.rackSeed);
    }
    if (
      (decision.kind === "push-out" || decision.kind === "illegal-break") &&
      (move.choice === "accept" || move.choice === "return")
    ) {
      return {
        ...state,
        decision: null,
        turnSeat: move.choice === "accept" ? decision.seat : decision.shooter,
        pushOutAvailable:
          decision.kind === "illegal-break" && move.choice === "return",
      };
    }
    throw new Error("billiards: invalid nine-ball decision");
  }
  if (move.type === "propose-stalemate")
    return {
      ...state,
      decision: {
        kind: "stalemate",
        seat: 1 - state.turnSeat,
        proposer: state.turnSeat,
      },
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
  throw new Error("billiards: invalid nine-ball action");
}
