import { createBoardSession } from "../engine/board-session";
import { GameSessionStore } from "../engine/game-session-store";
import { junqiAi } from "./ai";
import { junqiCheckpointSchema } from "./checkpoint";
import { exitJunqiRoom } from "./online-session";
import { createInitialState, junqiGame } from "./rules";
import {
  JUNQI_GAME_ID,
  type JunqiMode,
  type JunqiMove,
  type JunqiPresentation,
  type JunqiState,
} from "./types";

export const junqiSessions = new GameSessionStore<
  JunqiMode,
  JunqiState,
  JunqiMove,
  JunqiPresentation
>({
  gameId: JUNQI_GAME_ID,
  schema: junqiCheckpointSchema,
  online: (mode) => mode.kind === "online",
  exitOnline: (mode) => exitJunqiRoom(mode.variant),
  create: (mode, hooks, checkpoint) =>
    createBoardSession(
      mode,
      junqiGame,
      createInitialState(
        mode.variant,
        crypto.getRandomValues(new Uint32Array(1))[0],
      ),
      junqiAi,
      hooks,
      checkpoint,
    ),
});
