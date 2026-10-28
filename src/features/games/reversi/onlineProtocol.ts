import { z } from "zod";

import type { OnlineGame } from "../engine/online/matchTypes";
import { hashString } from "../engine/online/session";
import { serializeReversiState } from "./checkpoint";
import { createInitialReversiState, reversiGame } from "./rules";
import type { ReversiMove, ReversiPresentation, ReversiState } from "./types";

const coordinate = z.number().int().min(0).max(7);
const moveSchema = z.strictObject({ row: coordinate, col: coordinate });

export function parseReversiMove(value: unknown): ReversiMove | null {
  const result = moveSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const REVERSI_ONLINE: OnlineGame<
  ReversiState,
  ReversiMove,
  ReversiPresentation
> = {
  game: reversiGame,
  initialState: createInitialReversiState,
  hash: (state) => hashString(serializeReversiState(state)),
};
