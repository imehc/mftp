import { Trans } from "@lingui/react/macro";

import { historyResult as result } from "../engine/black-white-labels";
import type { ReversiHistoryPayload } from "./types";

export { historyModeLabel } from "../engine/history-labels";
export { seatName, matchResultLabel } from "../engine/black-white-labels";

export function historyResult(payload: ReversiHistoryPayload) {
  const { black, white } = payload;
  return (
    <>
      {result(payload)} ·{" "}
      <Trans comment="黑白棋结束时的双方棋子数量">
        黑 {black} / 白 {white}
      </Trans>
    </>
  );
}
