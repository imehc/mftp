import { combat } from "./combat";
import { canDeploy } from "./deployment";
import { opaqueBoard } from "./initial";
import { destinations } from "./movement";
import { applyOpenAction } from "./open-rules";
import {
  type HiddenState,
  type JunqiMove,
  type Knowledge,
  type Piece,
  PIECE_COUNTS,
  type PieceKind,
  type Side,
} from "./types";

const kinds = Object.keys(PIECE_COUNTS) as PieceKind[];

function initialKnowledge(state: HiddenState, viewer: Side): Knowledge {
  return Object.fromEntries(
    state.board.flatMap((piece, index) =>
      piece && piece.side !== viewer
        ? [
            [
              piece.id,
              kinds.filter((kind) => canDeploy({ ...piece, kind }, index)),
            ],
          ]
        : [],
    ),
  );
}

function observe(
  before: HiddenState,
  next: HiddenState,
  move: JunqiMove,
  viewer: Side,
): Knowledge {
  const knowledge = structuredClone(before.knowledge[viewer]);
  if (move.type !== "move") return knowledge;
  const attacker = before.board[move.from];
  const defender = before.board[move.to];
  if (!attacker) return knowledge;
  if (attacker.side !== viewer) {
    // 用公开走法约束候选身份；路径其余部分只读取占位和阵营。
    knowledge[attacker.id] = (knowledge[attacker.id] ?? kinds).filter(
      (kind) => {
        const board = [...before.board];
        board[move.from] = { ...attacker, kind };
        return destinations(board, move.from).includes(move.to);
      },
    );
  }
  if (defender && next.lastCombat) {
    const candidates = (piece: Piece) =>
      piece.side === viewer ? [piece.kind] : (knowledge[piece.id] ?? kinds);
    const a = candidates(attacker),
      b = candidates(defender);
    if (attacker.side !== viewer)
      knowledge[attacker.id] = a.filter((kind) =>
        b.some((other) => combat(kind, other) === next.lastCombat),
      );
    if (defender.side !== viewer)
      knowledge[defender.id] = b.filter((kind) =>
        a.some((other) => combat(other, kind) === next.lastCombat),
      );
  }
  const enemy = viewer === 0 ? 1 : 0;
  if (next.flagShown[enemy]) {
    const flag = next.board.find(
      (piece) => piece?.side === enemy && piece.kind === "flag",
    );
    if (flag) knowledge[flag.id] = ["flag"];
    if (!before.flagShown[enemy]) {
      for (const piece of [attacker, defender])
        if (
          piece?.side === enemy &&
          !next.board.some((p) => p?.id === piece.id)
        )
          knowledge[piece.id] = ["commander"];
    }
  }
  // 已确定身份（包含阵亡棋子）占用原始配额，其他候选不能再使用耗尽的种类。
  for (let pass = 0; pass < kinds.length; pass++) {
    const certain = Object.values(knowledge)
      .filter((value) => value.length === 1)
      .map(([kind]) => kind);
    let changed = false;
    for (const [id, values] of Object.entries(knowledge)) {
      if (values.length <= 1) continue;
      const possible = values.filter(
        (kind) =>
          certain.filter((value) => value === kind).length < PIECE_COUNTS[kind],
      );
      if (possible.length && possible.length !== values.length) {
        knowledge[id] = possible;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return knowledge;
}

export function applyHiddenAction(
  state: HiddenState,
  move: JunqiMove,
  seat: number,
): HiddenState {
  const classic = applyOpenAction({ ...state, variant: "open" }, move, seat);
  const next: HiddenState = {
    ...classic,
    variant: "hidden",
    seed: state.seed,
    flagShown: [...state.flagShown],
    knowledge: state.knowledge,
  };
  if (move.type === "arrange")
    next.board = opaqueBoard(
      next.board,
      state.seed ^ next.revision ^ move.seed,
      state.turnSeat,
    );
  if (state.phase === "deployment") {
    if (next.phase === "playing")
      next.knowledge = [initialKnowledge(next, 0), initialKnowledge(next, 1)];
    return next;
  }
  for (const side of [0, 1] as const)
    if (
      state.board.some((p) => p?.side === side && p.kind === "commander") &&
      !next.board.some((p) => p?.side === side && p.kind === "commander")
    )
      next.flagShown[side] = true;
  next.knowledge = [
    observe(state, next, move, 0),
    observe(state, next, move, 1),
  ];
  return next;
}
