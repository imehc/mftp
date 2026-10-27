import { createRng, type Difficulty, yieldToUi } from "../engine/ai";
import { frontDistance, homeSide, isHeadquarters } from "./board";
import { combat, RANK } from "./combat";
import { invalidAction } from "./errors";
import { destinations } from "./movement";
import {
  type JunqiMove,
  PIECE_COUNTS,
  type PieceKind,
  type Side,
} from "./types";
import type { JunqiView, ViewBoard, ViewPiece } from "./view-types";
import { viewActions } from "./visibility";

const kinds = Object.keys(PIECE_COUNTS) as PieceKind[];
const values: Record<PieceKind, number> = {
  ...RANK,
  flag: 1000,
  mine: 3,
  bomb: 7,
  engineer: 4,
};

function candidates(view: JunqiView, piece: ViewPiece): PieceKind[] {
  return piece.face === "known"
    ? [piece.kind]
    : (view.candidates[piece.id] ?? kinds);
}

function exchange(attacker: PieceKind, defenders: PieceKind[]): number {
  return (
    defenders.reduce((sum, defender) => {
      const result = combat(attacker, defender);
      return (
        sum +
        (result !== "defender" ? values[defender] : 0) -
        (result !== "attacker" ? values[attacker] : 0)
      );
    }, 0) / defenders.length
  );
}

function threat(
  view: JunqiView,
  board: ViewBoard,
  target: number,
  side: Side,
  kind: PieceKind,
): number {
  let danger = 0;
  for (let from = 0; from < board.length; from++) {
    const enemy = board[from];
    if (!enemy || enemy.side === null || enemy.side === side) continue;
    const possible = candidates(view, enemy);
    let harm = 0;
    for (const rank of possible) {
      const assumed = [...board];
      assumed[from] = {
        id: enemy.id,
        side: enemy.side,
        face: "known",
        kind: rank,
      };
      if (
        destinations(assumed, from, {
          lockHeadquarters: view.variant !== "flip",
          covered:
            view.variant === "flip"
              ? board.flatMap((p) => (p?.face === "covered" ? [p.id] : []))
              : [],
        }).includes(target) &&
        combat(rank, kind) !== "defender"
      )
        harm++;
    }
    danger = Math.max(danger, (harm / possible.length) * values[kind]);
  }
  return danger;
}

// 策略只接收投影副本；不得引入裁判状态、完整历史或真实随机种子。
export async function chooseObservedMove(
  view: JunqiView,
  seat: Side,
  difficulty: Difficulty,
  signal: AbortSignal,
): Promise<JunqiMove> {
  signal.throwIfAborted();
  if (view.phase === "deployment") return { type: "ready" };
  const actions = viewActions(view);
  if (!actions.length) throw invalidAction("junqi: no observed legal action");
  const rng = createRng(view.ply * 173 + seat * 71);
  const deadline =
    performance.now() +
    (difficulty === "easy" ? 80 : difficulty === "medium" ? 240 : 550);
  const budget =
    difficulty === "easy" ? 300 : difficulty === "medium" ? 1000 : 3000;
  let best = -Infinity,
    chosen = actions[0],
    nodes = 0,
    iterations = 0;
  const ordered = [...actions].sort((a, b) => {
    const score = (action: JunqiMove) =>
      action.type === "move" && view.board[action.to]?.kind === "flag" ? 1 : 0;
    return score(b) - score(a);
  });
  for (const action of ordered) {
    signal.throwIfAborted();
    nodes++;
    if (++iterations % 4 === 0) await yieldToUi();
    signal.throwIfAborted();
    if (nodes > budget || performance.now() > deadline) break;
    let score = 0;
    if (action.type === "flip") {
      const adjacent = [
        action.at - 5,
        action.at + 5,
        action.at - 1,
        action.at + 1,
      ].filter((at) => Math.abs((at % 5) - (action.at % 5)) <= 1);
      score =
        0.25 +
        adjacent.reduce((value, at) => {
          const piece = view.board[at];
          return (
            value +
            (piece?.face === "known" && piece.side === view.viewerSide
              ? piece.kind === "flag"
                ? -5
                : 0.2
              : 0)
          );
        }, 0);
    } else if (action.type === "move") {
      const attacker = view.board[action.from],
        defender = view.board[action.to];
      if (attacker?.face !== "known") continue;
      if (defender?.face === "known" && defender.kind === "flag") return action;
      score = defender
        ? exchange(attacker.kind, candidates(view, defender))
        : 0;
      const progress = (index: number) =>
        homeSide(index) === attacker.side
          ? 5 - frontDistance(index)
          : 6 + frontDistance(index);
      score += (progress(action.to) - progress(action.from)) * 0.1;
      if (view.variant !== "flip" && isHeadquarters(action.to))
        score -= values[attacker.kind] * 0.7;
      if (difficulty !== "easy") {
        const board = [...view.board];
        board[action.from] = null;
        board[action.to] = attacker;
        score -=
          threat(view, board, action.to, attacker.side, attacker.kind) * 0.8;
        nodes += board.filter(Boolean).length;
        if (difficulty === "hard") {
          const flag = board.findIndex(
            (p) => p?.side === attacker.side && p.kind === "flag",
          );
          if (flag >= 0)
            score -= threat(view, board, flag, attacker.side, "flag") * 2;
        }
      }
    }
    if (score > best || (score === best && rng() > 0.6)) {
      best = score;
      chosen = action;
    }
  }
  signal.throwIfAborted();
  return chosen;
}
