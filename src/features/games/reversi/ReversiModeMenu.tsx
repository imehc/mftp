import { BoardModeMenu } from "../engine/BoardModeMenu";
import { historyModeLabel, historyResult } from "./labels";
import {
  REVERSI_GAME_ID,
  type ReversiHistoryPayload,
  type ReversiMode,
} from "./types";

export function ReversiModeMenu({
  onStart,
}: {
  onStart: (mode: ReversiMode) => void;
}) {
  return (
    <BoardModeMenu<ReversiHistoryPayload>
      gameId={REVERSI_GAME_ID}
      onStart={onStart}
      historyMode={historyModeLabel}
      historyResult={historyResult}
    />
  );
}
