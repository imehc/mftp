import { createBoardSession } from "../engine/board-session";
import { GameSessionStore } from "../engine/game-session-store";
import { exitOnlineRoom } from "../engine/online/online-session-store";
import { reversiAiStrategy } from "./ai";
import { reversiCheckpointSchema } from "./checkpoint";
import { createInitialReversiState, reversiGame } from "./rules";
import {
  REVERSI_GAME_ID,
  type ReversiMode,
  type ReversiMove,
  type ReversiPresentation,
  type ReversiState,
} from "./types";

export const reversiSessions = new GameSessionStore<
  ReversiMode,
  ReversiState,
  ReversiMove,
  ReversiPresentation
>({
  gameId: REVERSI_GAME_ID,
  schema: reversiCheckpointSchema,
  create: (mode, hooks, checkpoint) =>
    createBoardSession(
      mode,
      reversiGame,
      createInitialReversiState(),
      reversiAiStrategy,
      hooks,
      checkpoint,
    ),
  online: (mode) => mode.kind === "online",
  exitOnline: () => exitOnlineRoom(REVERSI_GAME_ID),
});
