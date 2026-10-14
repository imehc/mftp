import type { AiStrategy, Difficulty } from "./ai";
import { AiController, LocalController } from "./controllers";
import { type MatchHooks, MatchRunner } from "./match";
import type { GameDefinition } from "./types";

type BoardMode =
  | { kind: "hotseat" }
  | { kind: "ai"; localSeat: number; difficulty: Difficulty }
  | { kind: "online" };

export function createBoardSession<State, Move, Presentation>(
  mode: BoardMode,
  game: GameDefinition<State, Move, Presentation>,
  initial: State,
  strategy: AiStrategy<State, Move>,
  hooks: MatchHooks<State, Move, Presentation>,
  checkpoint: { id: string; history?: State[] },
) {
  if (mode.kind === "online")
    throw new Error("Online matches require a room session");
  const local = new LocalController<State, Move>();
  const ai =
    mode.kind === "ai"
      ? new AiController(strategy, mode.difficulty, 350)
      : null;
  const controllers = ai
    ? mode.kind === "ai" && mode.localSeat === 1
      ? [ai, local]
      : [local, ai]
    : [local, local];
  const runner = new MatchRunner(game, initial, controllers, hooks, checkpoint);
  return { local, runner };
}
