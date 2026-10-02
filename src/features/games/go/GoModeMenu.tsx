import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { BoardModeMenu, GameSelect } from "../engine/BoardModeMenu";
import { historyModeLabel, historyResult } from "./labels";
import {
  BOARD_SIZES,
  DEFAULT_BOARD_SIZE,
  GO_GAME_ID,
  type BoardSize,
  type GoHistoryPayload,
  type GoMode,
} from "./types";
export function GoModeMenu({ onStart }: { onStart: (mode: GoMode) => void }) {
  const [boardSize, setBoardSize] = useState<BoardSize>(DEFAULT_BOARD_SIZE);
  return (
    <BoardModeMenu<GoHistoryPayload>
      gameId={GO_GAME_ID}
      onStart={(mode) => onStart({ ...mode, boardSize })}
      options={
        <GameSelect
          label={<Trans>棋盘大小</Trans>}
          value={String(boardSize)}
          onChange={(value) => setBoardSize(Number(value) as BoardSize)}
          options={BOARD_SIZES.map((size) => ({
            value: String(size),
            label: `${size} × ${size}`,
          }))}
        />
      }
      historyMode={(payload) => (
        <>
          {historyModeLabel(payload)} · {payload.boardSize} ×{" "}
          {payload.boardSize}
        </>
      )}
      historyResult={historyResult}
    />
  );
}
