import type { AiStrategy } from "../engine/ai";
import { chooseObservedMove } from "./observed-ai";
import { openAi } from "./open-ai";
import type { JunqiMove, Side } from "./types";
import type { JunqiObservation } from "./view-types";

export const junqiAi: AiStrategy<JunqiObservation, JunqiMove> = {
  chooseMove(observation, seat, difficulty, signal) {
    if (observation.openState)
      return openAi.chooseMove(observation.openState, seat, difficulty, signal);
    return chooseObservedMove(
      observation.view,
      seat as Side,
      difficulty,
      signal,
    );
  },
};
