import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { LightNotice, type LightNoticeMessage } from "~/components/LightNotice";

import type { Difficulty } from "./ai";
import { GameToolbar } from "./GameToolbar";
import { historyModeLabel } from "./history-labels";
import type { SeatIndex } from "./types";

/** 棋盘独立适配剩余空间，操作与状态共用顶部工具栏。 */
export function BoardMatchLayout({
  title,
  mode,
  localSeat,
  red = false,
  details,
  metrics,
  activity,
  controls,
  finished,
  children,
  notice = null,
}: {
  title: ReactNode;
  mode: { kind: "ai" | "hotseat" | "online"; difficulty?: Difficulty };
  localSeat: SeatIndex;
  red?: boolean;
  details?: ReactNode;
  metrics: ReactNode;
  activity?: ReactNode;
  controls: ReactNode;
  finished: boolean;
  children: ReactNode;
  notice?: LightNoticeMessage | null;
}) {
  return (
    <>
      <GameToolbar
        context={
          <>
            <span>
              {historyModeLabel({
                mode: mode.kind,
                difficulty: mode.difficulty,
              })}
            </span>
            {mode.kind !== "hotseat" ? (
              <span>
                {localSeat === 0 ? (
                  red ? (
                    <Trans>你执红</Trans>
                  ) : (
                    <Trans>你执黑</Trans>
                  )
                ) : red ? (
                  <Trans>你执黑</Trans>
                ) : (
                  <Trans>你执白</Trans>
                )}
              </span>
            ) : null}
          </>
        }
        actions={finished ? null : controls}
        status={activity || title}
        metrics={metrics}
        details={details}
      />
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden px-3 py-2 md:px-4">
        {children}
        <LightNotice notice={notice} />
      </div>
    </>
  );
}
