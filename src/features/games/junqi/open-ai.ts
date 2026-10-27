import { type AiStrategy, createRng, yieldToUi } from "../engine/ai";
import { frontDistance, homeSide, isHeadquarters } from "./board";
import { combat, RANK } from "./combat";
import { invalidAction } from "./errors";
import { legalMoves } from "./movement";
import { applyAction } from "./rules";
import {
  type JunqiMove,
  type JunqiState,
  type PieceKind,
  type Side,
  type Step,
} from "./types";

const VALUE: Record<PieceKind, number> = {
  ...RANK,
  flag: 1000,
  mine: 3,
  bomb: 7,
  engineer: 4,
};

function evaluate(state: JunqiState, side: Side): number {
  if (state.phase === "finished")
    return state.winner === null
      ? 0
      : state.winner === side
        ? 100000 - state.ply
        : -100000 + state.ply;
  return state.board.reduce((value, piece, index) => {
    if (!piece) return value;
    const mobile = piece.kind !== "flag" && piece.kind !== "mine";
    const advance = mobile
      ? (homeSide(index) === piece.side
          ? 5 - frontDistance(index)
          : 6 + frontDistance(index)) * 0.12
      : 0;
    const trapped =
      mobile && isHeadquarters(index) ? VALUE[piece.kind] * 0.7 : 0;
    return (
      value +
      (piece.side === side ? 1 : -1) * (VALUE[piece.kind] + advance - trapped)
    );
  }, 0);
}

function priority(state: JunqiState, move: Step): number {
  const a = state.board[move.from],
    b = state.board[move.to];
  if (!a || !b) return 0;
  if (b.kind === "flag") return 10000;
  const result = combat(a.kind, b.kind);
  return (
    (result !== "defender" ? VALUE[b.kind] : 0) -
    (result !== "attacker" ? VALUE[a.kind] : 0)
  );
}

export const openAi: AiStrategy<JunqiState, JunqiMove> = {
  async chooseMove(state, seat, difficulty, signal) {
    signal.throwIfAborted();
    if (state.phase === "deployment")
      return state.lastAction?.type === "arrange"
        ? { type: "ready" }
        : { type: "arrange", seed: 19301 + seat * 703 + state.revision };
    const side = seat as Side;
    const rng = createRng(state.ply * 173 + seat * 71);
    const moves = legalMoves(state.board, side).sort(
      (a, b) => priority(state, b) - priority(state, a),
    );
    if (!moves.length) throw invalidAction("junqi: computer has no legal move");
    let chosen = moves[0];
    const limit = difficulty === "easy" ? 1 : difficulty === "medium" ? 2 : 3;
    const maxNodes =
      difficulty === "easy" ? 300 : difficulty === "medium" ? 1400 : 4000;
    const deadline =
      performance.now() +
      (difficulty === "easy" ? 80 : difficulty === "medium" ? 240 : 550);
    let nodes = 0,
      exhausted = false;

    async function search(
      position: JunqiState,
      depth: number,
      alpha: number,
      beta: number,
    ): Promise<number> {
      signal.throwIfAborted();
      if (++nodes % 24 === 0) await yieldToUi();
      if (nodes >= maxNodes || performance.now() >= deadline) exhausted = true;
      if (depth === 0 || position.phase === "finished" || exhausted)
        return evaluate(position, side);
      const maximizing = position.turnSeat === side;
      let best = maximizing ? -Infinity : Infinity;
      const replies = legalMoves(position.board, position.turnSeat).sort(
        (a, b) => priority(position, b) - priority(position, a),
      );
      for (const reply of replies) {
        const value = await search(
          applyAction(position, reply, position.turnSeat),
          depth - 1,
          alpha,
          beta,
        );
        best = maximizing ? Math.max(best, value) : Math.min(best, value);
        if (maximizing) alpha = Math.max(alpha, best);
        else beta = Math.min(beta, best);
        if (beta <= alpha || exhausted) break;
      }
      return best;
    }

    for (let depth = 1; depth <= limit && !exhausted; depth++) {
      let best = -Infinity,
        candidate = chosen;
      for (const move of moves) {
        const value = await search(
          applyAction(state, move, seat),
          depth - 1,
          best,
          Infinity,
        );
        if (
          value > best ||
          (difficulty === "easy" && value === best && rng() > 0.6)
        ) {
          best = value;
          candidate = move;
        }
        if (exhausted) break;
      }
      if (!exhausted) chosen = candidate;
    }
    signal.throwIfAborted();
    return chosen;
  },
};
