import type { GameDefinition } from "../engine/types";
import { applyFlipAction, flipPositionKey } from "./flip-rules";
import { applyHiddenAction } from "./hidden-rules";
import { createGameState } from "./initial";
import { applyOpenAction } from "./open-rules";
import {
  JUNQI_GAME_ID,
  type JunqiMove,
  type JunqiPresentation,
  type JunqiState,
  type JunqiVariant,
} from "./types";

export { positionKey } from "./open-rules";

export function createInitialState(
  variant: JunqiVariant = "open",
  seed = 0,
): JunqiState {
  const state = createGameState(variant, seed);
  if (state.variant === "flip")
    state.positions = { [flipPositionKey(state)]: 1 };
  return state;
}

export function applyAction(
  state: JunqiState,
  move: JunqiMove,
  seat: number,
): JunqiState {
  if (state.variant === "hidden") return applyHiddenAction(state, move, seat);
  if (state.variant === "flip") return applyFlipAction(state, move, seat);
  return applyOpenAction(state, move, seat);
}

export const junqiGame: GameDefinition<
  JunqiState,
  JunqiMove,
  JunqiPresentation
> = {
  id: JUNQI_GAME_ID,
  seatCount: 2,
  currentSeat: (state) => (state.phase === "finished" ? null : state.turnSeat),
  winnerSeat: (state) => state.winner,
  isFinished: (state) => state.phase === "finished",
  applyMove(state, move, seat) {
    return {
      state: applyAction(state, move, seat),
      presentation: {
        moved: move.type === "move" || move.type === "flip",
        capture: move.type === "move" && state.board[move.to] !== null,
      },
    };
  },
};
