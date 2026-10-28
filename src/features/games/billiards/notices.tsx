import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { FoulSummary } from "./BilliardsFoulFeedback";
import { foulFeedback } from "./foul-feedback";
import type { BilliardsMode, BilliardsState } from "./types";

export interface BilliardsNotice {
  id: string;
  tone: "warning" | "info";
  title: ReactNode;
  description?: ReactNode;
}

/**
 * 把台面状态映射为待展示的顶部消息。
 *
 * 仅包含需要打断/提示玩家的犯规、手中球与黑八复位；「电脑思考中」属于持续
 * 状态，改由其座位徽章承载，不占用消息位。`id` 由内容推导，供轻提示去重
 * 与更新，避免重复播放动画。
 */
export function billiardsNotices(
  state: BilliardsState,
  mode: BilliardsMode,
  ballInHand: boolean,
): BilliardsNotice[] {
  const notices: BilliardsNotice[] = [];
  const feedback = foulFeedback(state);
  if (feedback) {
    notices.push({
      id: `foul:${feedback.shooter ?? "-"}:${feedback.reason}:${feedback.penalty}`,
      tone: "warning",
      title: <FoulSummary feedback={feedback} mode={mode} />,
    });
  }
  if (ballInHand) {
    const region =
      state.variant === "snooker" ? (state.placementRegion ?? "any") : "any";
    notices.push({
      id: `ball-in-hand:${region}`,
      tone: "info",
      title:
        state.variant === "snooker" ? (
          state.placementRegion === "d" ? (
            <Trans>手中球：在 D 区拖动母球放置</Trans>
          ) : (
            <Trans>手中球：可在全台放置母球</Trans>
          )
        ) : (
          <Trans>自由球：拖动母球放置</Trans>
        ),
    });
  }
  if (state.lastOutcome?.respottedEight) {
    notices.push({
      id: "respotted-eight",
      tone: "info",
      title: <Trans>黑八已重置</Trans>,
    });
  }
  return notices;
}
