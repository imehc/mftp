import { CELLS } from "./board";
import { combat } from "./combat";
import { arrangeSide, canSwap, validDeployment } from "./deployment";
import { invalidAction } from "./errors";
import { destinations, legalMoves } from "./movement";
import { type JunqiMove, type OpenState, opponent, type Side } from "./types";

export function positionKey(
  state: Pick<OpenState, "board" | "turnSeat">,
): string {
  return `${state.turnSeat}|${state.board.map((piece) => (piece ? `${piece.side}:${piece.kind}` : "-")).join(",")}`;
}

export function createOpenInitialState(): OpenState {
  return {
    variant: "open",
    board: arrangeSide(arrangeSide(Array(CELLS).fill(null), 0, 73), 1, 107),
    phase: "deployment",
    ready: [false, false],
    turnSeat: 0,
    winner: null,
    reason: null,
    ply: 0,
    revision: 0,
    quiet: 0,
    positions: {},
    lastMove: null,
    lastAction: null,
    lastCombat: null,
  };
}

function finish(
  state: OpenState,
  winner: Side | null,
  reason: NonNullable<OpenState["reason"]>,
): OpenState {
  return { ...state, phase: "finished", winner, reason };
}

export function applyOpenAction(
  state: OpenState,
  move: JunqiMove,
  seat: number,
): OpenState {
  if (state.phase === "finished" || seat !== state.turnSeat)
    throw invalidAction("junqi: inactive seat");
  let next: OpenState = {
    ...state,
    revision: state.revision + 1,
    lastAction: move,
  };
  if (state.phase === "deployment") {
    if (
      move.type === "swap" &&
      canSwap(state.board, move.from, move.to, state.turnSeat)
    ) {
      next.board = [...state.board];
      [next.board[move.from], next.board[move.to]] = [
        next.board[move.to],
        next.board[move.from],
      ];
    } else if (
      move.type === "arrange" &&
      Number.isInteger(move.seed) &&
      move.seed >= 0 &&
      move.seed <= 0xffffffff
    ) {
      next.board = arrangeSide(state.board, state.turnSeat, move.seed);
    } else if (
      move.type === "ready" &&
      validDeployment(state.board, state.turnSeat)
    ) {
      next.ready = [...state.ready];
      next.ready[state.turnSeat] = true;
      if (next.ready.every(Boolean)) {
        next.phase = "playing";
        next.turnSeat = 0;
        next.positions = { [positionKey(next)]: 1 };
      } else next.turnSeat = opponent(state.turnSeat);
    } else throw invalidAction("junqi: invalid deployment action");
    return next;
  }
  if (move.type === "concede")
    return finish(next, opponent(state.turnSeat), "concede");
  if (
    move.type !== "move" ||
    state.board[move.from]?.side !== seat ||
    !destinations(state.board, move.from).includes(move.to)
  )
    throw invalidAction("junqi: illegal move");
  const attacker = state.board[move.from],
    defender = state.board[move.to];
  if (!attacker) throw invalidAction("junqi: missing attacker");
  const outcome = defender ? combat(attacker.kind, defender.kind) : null;
  const board = [...state.board];
  board[move.from] = null;
  board[move.to] =
    outcome === "both" ? null : outcome === "defender" ? defender : attacker;
  next = {
    ...next,
    board,
    turnSeat: opponent(state.turnSeat),
    ply: state.ply + 1,
    quiet: defender ? 0 : state.quiet + 1,
    lastMove: move,
    lastCombat: outcome,
  };
  if (defender?.kind === "flag") return finish(next, state.turnSeat, "flag");
  if (legalMoves(board, next.turnSeat).length === 0)
    return finish(next, state.turnSeat, "immobilized");
  const key = positionKey(next);
  next.positions = {
    ...state.positions,
    [key]: (state.positions[key] ?? 0) + 1,
  };
  if (next.positions[key] >= 3) return finish(next, null, "repetition");
  if (next.quiet >= 100) return finish(next, null, "no-capture");
  return next;
}
