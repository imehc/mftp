import type { OnlineGame } from "../engine/online/matchTypes";
import { hashString } from "../engine/online/session";
import { serializeChessState } from "./checkpoint";
import { chessGame, createChessState } from "./rules";
import type { ChessMove, ChessPresentation, ChessState } from "./types";

export { parseChessMove } from "./checkpoint";

export const CHESS_ONLINE: OnlineGame<
  ChessState,
  ChessMove,
  ChessPresentation
> = {
  game: chessGame,
  initialState: createChessState,
  hash: (state) => hashString(serializeChessState(state)),
};
