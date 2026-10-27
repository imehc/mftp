import type { AiStrategy } from "../engine/ai";
import { chooseObservedMove } from "./observed-ai";
import { openAi } from "./open-ai";
import type { JunqiMove, JunqiState, Side } from "./types";
import { projectView } from "./visibility";

export const junqiAi: AiStrategy<JunqiState, JunqiMove> = {
  chooseMove(state, seat, difficulty, signal) {
    if (state.variant === "open")
      return openAi.chooseMove(state, seat, difficulty, signal);
    return chooseObservedMove(
      projectView(state, seat as Side),
      seat as Side,
      difficulty,
      signal,
    );
  },
};
