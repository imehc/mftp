import { Trans } from "@lingui/react/macro";

import { foulLabel, FoulSummary } from "./BilliardsFoulFeedback";
import { foulFeedback } from "./foul-feedback";
import type { BilliardsMode, BilliardsState } from "./types";

export function BilliardsStatus({
  state,
  mode,
  ballInHand,
  aiThinking,
}: {
  state: BilliardsState;
  mode: BilliardsMode;
  ballInHand: boolean;
  aiThinking: boolean;
}) {
  const feedback = foulFeedback(state);
  return (
    <div
      className="billiards-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center text-xs">
        {feedback ? (
          <>
            <span className="text-destructive">
              <FoulSummary feedback={feedback} mode={mode} />
            </span>
            <span className="text-muted-foreground">
              {foulLabel(feedback.reason)}
            </span>
          </>
        ) : null}
        {ballInHand ? (
          <span>
            {state.variant === "snooker" ? (
              state.placementRegion === "d" ? (
                <Trans>手中球：在 D 区拖动母球放置</Trans>
              ) : (
                <Trans>手中球：可在全台放置母球</Trans>
              )
            ) : (
              <Trans>自由球：拖动母球放置</Trans>
            )}
          </span>
        ) : aiThinking ? (
          <span className="text-muted-foreground">
            <Trans>AI 思考中…</Trans>
          </span>
        ) : state.lastOutcome?.respottedEight ? (
          <span className="text-muted-foreground">
            <Trans>黑八已重置</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
}
