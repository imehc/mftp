import { Chess } from "chess.js";

import type { MatchSnapshot } from "../engine/match";
import { seatFor } from "./rules";
import type { ChessSession, ChessState } from "./types";

export function chessUndoPlies(
  runner: ChessSession["runner"],
  snapshot: MatchSnapshot<ChessState>,
  seat?: number,
): number {
  if (snapshot.phase !== "awaiting-move") return 0;
  const history = runner.getCheckpoint();
  if (history.length < 2) return 0;
  if (seat === undefined) return 1;
  for (let index = history.length - 1; index > 0; index--) {
    if (seatFor(new Chess(history[index - 1].fen).turn()) === seat)
      return history.length - index;
  }
  return 0;
}
