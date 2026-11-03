import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { LightNotice, type LightNoticeMessage } from "~/components/LightNotice";

import type { Difficulty } from "./ai";
import { boardPlayers } from "./board-players";
import { GameToolbar } from "./GameToolbar";
import { historyModeLabel } from "./history-labels";
import type { SeatIndex } from "./types";

/** 棋盘独立适配剩余空间，操作与状态共用顶部工具栏。 */
export function BoardMatchLayout({
  title,
  mode,
  localSeat,
  activeSeat,
  red = false,
  details,
  playerStats,
  metrics,
  activity,
  activityActions,
  controls,
  menuActions,
  finished,
  children,
  notice = null,
  modeLabel,
}: {
  title: ReactNode;
  mode: {
    kind: "ai" | "hotseat" | "online";
    difficulty?: Difficulty;
  };
  /** 游戏自己的对手标签；共享布局不解释专属模式。 */
  modeLabel?: ReactNode;
  localSeat: SeatIndex;
  activeSeat?: SeatIndex | null;
  red?: boolean;
  details?: ReactNode;
  playerStats?: { local?: ReactNode; opponent?: ReactNode };
  metrics: ReactNode;
  activity?: ReactNode;
  /** 内容区状态行中的恢复动作；文字可截断，动作保持可操作。 */
  activityActions?: ReactNode;
  controls: ReactNode;
  /** 只进更多菜单的视角类动作。 */
  menuActions?: ReactNode;
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
              {modeLabel ??
                historyModeLabel({
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
        statusActions={activityActions}
        players={boardPlayers({
          kind: mode.kind,
          localSeat,
          activeSeat,
          firstColor: red ? "red" : "black",
          activity,
          stats: playerStats,
        })}
        metrics={metrics}
        details={details}
        menuActions={menuActions}
      />
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden px-3 py-2 md:px-4">
        {children}
        <LightNotice notice={notice} />
      </div>
    </>
  );
}
