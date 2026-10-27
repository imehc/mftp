import { destinations } from "./movement";
import { type JunqiMove, type JunqiState, seatSide, type Side } from "./types";
import type { JunqiView } from "./view-types";

export function projectView(state: JunqiState, viewer: Side): JunqiView {
  const viewerSide = seatSide(state, viewer);
  return {
    variant: state.variant,
    board: state.board.map((piece) => {
      if (!piece) return null;
      const known =
        state.phase === "finished" ||
        state.variant === "open" ||
        (state.variant === "hidden" &&
          (piece.side === viewerSide ||
            (piece.kind === "flag" && state.flagShown[piece.side]))) ||
        (state.variant === "flip" && state.revealed.includes(piece.id));
      return known
        ? { id: piece.id, side: piece.side, face: "known", kind: piece.kind }
        : {
            id: piece.id,
            side: state.variant === "flip" ? null : piece.side,
            face: "covered",
          };
    }),
    phase: state.phase,
    turnSeat: state.turnSeat,
    turnSide: seatSide(state, state.turnSeat),
    viewerSide,
    winner: state.winner === null ? null : seatSide(state, state.winner),
    reason: state.reason,
    ply: state.ply,
    revision: state.revision,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastCombat: state.lastCombat,
    candidates:
      state.variant === "hidden"
        ? structuredClone(state.knowledge[viewer])
        : {},
  };
}

export function viewDestinations(view: JunqiView, from: number): number[] {
  return destinations(view.board, from, {
    lockHeadquarters: view.variant !== "flip",
    covered:
      view.variant === "flip"
        ? view.board.flatMap((p) => (p?.face === "covered" ? [p.id] : []))
        : [],
  });
}

export function viewActions(view: JunqiView): JunqiMove[] {
  if (view.phase !== "playing") return [];
  return view.board.flatMap((piece, from): JunqiMove[] => {
    if (!piece) return [];
    if (view.variant === "flip" && piece.face === "covered")
      return [{ type: "flip", at: from }];
    return piece.face === "known" && piece.side === view.turnSide
      ? viewDestinations(view, from).map((to) => ({ type: "move", from, to }))
      : [];
  });
}
