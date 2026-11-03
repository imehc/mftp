import { BoardModeMenu } from "../engine/BoardModeMenu";
import { historyModeLabel, historyResult } from "./labels";
import type { GomokuHistoryPayload, GomokuMode } from "./types";

export function GomokuModeMenu({
  onStart,
}: {
  onStart(mode: GomokuMode): void;
}) {
  return (
    <BoardModeMenu<GomokuHistoryPayload>
      gameId="gomoku"
      onStart={onStart}
      historyMode={historyModeLabel}
      historyResult={historyResult}
    />
  );
}
