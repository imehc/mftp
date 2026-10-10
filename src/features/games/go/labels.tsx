/** 围棋各界面共用的座位 / 结果 / 历史记录标签辅助函数。 */
import { Trans } from "@lingui/react/macro";

import { type GoState, KOMI } from "./types";

/** 中国规则数子计分：白方在盘面地域上加 7.5 贴目。 */
export function scoreLine(state: GoState) {
  if (!state.finalScore) return null;
  const [black, white] = state.finalScore;
  const whiteWithKomi = white + KOMI;
  return (
    <Trans>
      黑 {black} 子 · 白 {white} 子 + 贴目 {KOMI} = {whiteWithKomi}
    </Trans>
  );
}

export { historyModeLabel, formatHistoryTime } from "../engine/history-labels";
export {
  seatName,
  matchResultLabel,
  historyResult,
} from "../engine/black-white-labels";
