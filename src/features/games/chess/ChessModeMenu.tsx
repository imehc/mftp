import { Trans } from "@lingui/react/macro";

import { BoardModeMenu } from "../engine/BoardModeMenu";
import { historyModeLabel } from "../engine/history-labels";
import { chessHistoryResult } from "./labels";
import {
  CHESS_GAME_ID,
  type ChessHistoryPayload,
  type ChessMode,
} from "./types";

export function ChessModeMenu({ onStart }: { onStart(mode: ChessMode): void }) {
  return (
    <BoardModeMenu<ChessHistoryPayload>
      gameId={CHESS_GAME_ID}
      onStart={onStart}
      seatLabels={[
        <Trans key="white">先手（执白）</Trans>,
        <Trans key="black">后手（执黑）</Trans>,
      ]}
      historyMode={historyModeLabel}
      historyResult={chessHistoryResult}
    />
  );
}
