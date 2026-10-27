import { validCell } from "./board";
import { combat } from "./combat";
import { invalidAction } from "./errors";
import { type FlipState, type JunqiMove, opponent, type Side } from "./types";
import { projectView, viewActions } from "./visibility";

export function flipPositionKey(state: FlipState): string {
  return `${state.turnSeat}|${state.sides?.join("") ?? "-"}|${state.board
    .map((p) =>
      p
        ? state.revealed.includes(p.id)
          ? `${p.side}:${p.kind}`
          : `?${p.id}`
        : "-",
    )
    .join(",")}`;
}

export function applyFlipAction(
  state: FlipState,
  move: JunqiMove,
  seat: number,
): FlipState {
  if (state.phase !== "playing" || state.turnSeat !== seat)
    throw invalidAction("junqi: inactive flip seat");
  let next: FlipState = {
    ...state,
    revision: state.revision + 1,
    lastAction: move,
  };
  if (move.type === "concede" && !state.sides)
    throw invalidAction("junqi: reveal a piece before conceding");
  if (move.type === "concede")
    return {
      ...next,
      phase: "finished",
      winner: opponent(state.turnSeat),
      reason: "concede",
    };
  if (move.type === "flip") {
    const piece = validCell(move.at) ? state.board[move.at] : null;
    if (!piece || state.revealed.includes(piece.id))
      throw invalidAction("junqi: invalid reveal");
    const sides: [Side, Side] =
      state.turnSeat === 0
        ? [piece.side, opponent(piece.side)]
        : [opponent(piece.side), piece.side];
    next = {
      ...next,
      revealed: [...state.revealed, piece.id],
      sides: state.sides ?? sides,
      quiet: 0,
      lastMove: null,
      lastCombat: null,
    };
  } else if (move.type === "move") {
    const legal = viewActions(projectView(state, state.turnSeat));
    if (
      !legal.some(
        (action) =>
          action.type === "move" &&
          action.from === move.from &&
          action.to === move.to,
      )
    )
      throw invalidAction("junqi: illegal flip move");
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
      quiet: defender ? 0 : state.quiet + 1,
      lastMove: move,
      lastCombat: outcome,
    };
    if (defender?.kind === "flag")
      return {
        ...next,
        ply: state.ply + 1,
        phase: "finished",
        reason: "flag",
        winner: state.turnSeat,
      };
  } else throw invalidAction("junqi: invalid flip action");
  next = { ...next, ply: state.ply + 1, turnSeat: opponent(state.turnSeat) };
  if (!viewActions(projectView(next, next.turnSeat)).length)
    return {
      ...next,
      phase: "finished",
      reason: "immobilized",
      winner: state.turnSeat,
    };
  const key = flipPositionKey(next);
  next.positions = {
    ...state.positions,
    [key]: (state.positions[key] ?? 0) + 1,
  };
  if (next.positions[key] >= 3)
    return { ...next, phase: "finished", reason: "repetition", winner: null };
  if (next.quiet >= 100)
    return { ...next, phase: "finished", reason: "no-capture", winner: null };
  return next;
}
