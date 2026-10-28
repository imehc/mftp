import { createBoardSession } from "../engine/board-session";
import { GameSessionStore } from "../engine/game-session-store";
import { exitOnlineRoom } from "../engine/online/online-session-store";
import { chessAiStrategy } from "./ai";
import { chessCheckpointSchema } from "./checkpoint";
import { chessGame, createChessState } from "./rules";
import {
  CHESS_GAME_ID,
  type ChessMode,
  type ChessMove,
  type ChessPresentation,
  type ChessState,
} from "./types";

export const chessSessions = new GameSessionStore<
  ChessMode,
  ChessState,
  ChessMove,
  ChessPresentation
>({
  gameId: CHESS_GAME_ID,
  schema: chessCheckpointSchema,
  create: (mode, hooks, checkpoint) =>
    createBoardSession(
      mode,
      chessGame,
      createChessState(),
      chessAiStrategy,
      hooks,
      checkpoint,
    ),
  online: (mode) => mode.kind === "online",
  exitOnline: () => exitOnlineRoom(CHESS_GAME_ID),
});
