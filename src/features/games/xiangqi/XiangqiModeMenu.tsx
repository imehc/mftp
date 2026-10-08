import { BoardModeMenu } from "../engine/BoardModeMenu";
import { historyModeLabel, historyResult } from "./labels";
import {
  XIANGQI_GAME_ID,
  type XiangqiHistoryPayload,
  type XiangqiMode,
} from "./types";

export function XiangqiModeMenu({
  onStart,
}: {
  onStart: (mode: XiangqiMode) => void;
}) {
  return (
    <BoardModeMenu<XiangqiHistoryPayload>
      gameId={XIANGQI_GAME_ID}
      red
      onStart={onStart}
      historyMode={historyModeLabel}
      historyResult={historyResult}
    />
  );
}
