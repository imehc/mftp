import { useLingui } from "@lingui/react/macro";
import { useState } from "react";

import type { LightNoticeMessage } from "~/components/LightNotice";

import type { ReversiState } from "./types";

/** 跳过回合用短暂反馈说明，不改变棋盘的可用高度。 */
export function useReversiPassNotice(
  matchId: string,
  state: ReversiState,
): LightNoticeMessage | null {
  const { t } = useLingui();
  const [seen, setSeen] = useState({
    matchId,
    move: state.moveCount,
    sequence: 0,
    passed: null as number | null,
  });
  if (seen.matchId !== matchId || seen.move !== state.moveCount) {
    const advanced = seen.matchId === matchId && state.moveCount > seen.move;
    const announce = advanced && state.passedSeat !== null;
    // 在提交新快照前调整本地表现；恢复和悔棋不播报，重新走到跳过回合则重新计时。
    setSeen({
      matchId,
      move: state.moveCount,
      sequence: seen.sequence + (announce ? 1 : 0),
      passed: announce ? state.passedSeat : advanced ? seen.passed : null,
    });
  }
  if (seen.passed === null || state.finished) return null;
  const passedPlayer = seen.passed === 0 ? t`黑棋` : t`白棋`;
  return {
    id: `${matchId}-pass-${seen.sequence}`,
    message: t({
      message: `${passedPlayer}无合法落点，自动跳过本回合。`,
      comment: "黑白棋自动跳过无合法落点的一方，另一方继续",
    }),
  };
}
