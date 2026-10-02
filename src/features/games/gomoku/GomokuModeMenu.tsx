import { BoardModeMenu } from "../engine/BoardModeMenu";
import { historyModeLabel, historyResult } from "./labels";
import {
  GOMOKU_GAME_ID,
  type GomokuHistoryPayload,
  type GomokuMode,
} from "./types";
export function GomokuModeMenu({
  onStart,
}: {
  onStart: (mode: GomokuMode) => void;
}) {
  return (
    <BoardModeMenu<GomokuHistoryPayload>
      gameId={GOMOKU_GAME_ID}
      onStart={onStart}
      historyMode={historyModeLabel}
      historyResult={historyResult}
    />
  );
}
