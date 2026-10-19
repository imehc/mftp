import { AiController, LocalController } from "../engine/controllers";
import { GameSessionStore } from "../engine/game-session-store";
import { MatchRunner } from "../engine/match";
import { createBilliardsAiStrategy } from "./ai";
import { billiardsCheckpointSchema } from "./checkpoint";
import { createNineBallState } from "./nine-ball";
import { equipmentForState } from "./placement";
import { createBilliardsGame, createInitialState } from "./rules";
import { createSimulationClient } from "./simulation-client";
import { createSnookerState } from "./snooker";
import type {
  BilliardsMode,
  BilliardsMove,
  BilliardsPresentation,
  BilliardsState,
} from "./types";
import { BILLIARDS_GAME_ID } from "./types";

function initialState(mode: BilliardsMode): BilliardsState {
  const discipline = mode.discipline ?? "eight-ball";
  const variant = mode.kind === "practice" ? "practice" : discipline;
  const firstSeat =
    mode.kind === "ai"
      ? mode.playerBreaks
        ? 0
        : 1
      : mode.kind === "hotseat"
        ? (mode.firstSeat ?? 0)
        : 0;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  if (variant === "nine-ball") return createNineBallState(firstSeat, seed);
  if (variant === "snooker")
    return createSnookerState(
      mode.discipline === "snooker" ? mode.reds : 15,
      firstSeat,
      seed,
    );
  return createInitialState(
    variant,
    firstSeat,
    discipline,
    seed,
    mode.discipline === "snooker" ? mode.reds : 15,
  );
}

export const billiardsSessions = new GameSessionStore<
  BilliardsMode,
  BilliardsState,
  BilliardsMove,
  BilliardsPresentation
>({
  gameId: BILLIARDS_GAME_ID,
  schema: billiardsCheckpointSchema,
  create(mode, hooks, checkpoint) {
    const initial = checkpoint.history?.[0] ?? initialState(mode);
    const equipment = equipmentForState(initial);
    const simulation = createSimulationClient(equipment.id);
    try {
      const local = new LocalController<BilliardsState, BilliardsMove>();
      const controllers =
        mode.kind === "practice"
          ? [local]
          : mode.kind === "hotseat"
            ? [local, local]
            : [
                local,
                new AiController(
                  createBilliardsAiStrategy(simulation.shot, equipment),
                  mode.difficulty,
                ),
              ];
      const runner = new MatchRunner(
        createBilliardsGame(initial.variant, simulation.shot),
        initial,
        controllers,
        hooks,
        checkpoint,
      );
      return {
        runner,
        local,
        ready: simulation.ready,
        dispose: () => simulation.dispose(),
      };
    } catch (error) {
      simulation.dispose();
      throw error;
    }
  },
});
