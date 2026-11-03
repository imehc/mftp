import { Plural, Trans } from "@lingui/react/macro";

import { GameMatchDisplay } from "../engine/GameMatchDisplay";
import { GamePlayerLabel } from "../engine/GamePlayerLabel";
import { GameThinkingIndicator } from "../engine/GameThinkingIndicator";
import type { BilliardsMatchContext } from "./billiards-match-view-types";
import { BallIcon } from "./BilliardsScore";
import { lowestBall } from "./nine-ball";
import { SnookerTargetControl } from "./SnookerTargetControl";

/** 台球对局与棋类共享双方靠边、杆数居中的一行状态。 */
export function BilliardsMatchScore({
  match,
  aiThinking,
  target,
}: {
  match: BilliardsMatchContext;
  aiThinking: boolean;
  target: {
    enabled: boolean;
    kind: "color" | "free";
    onKind(kind: "color" | "free"): void;
  };
}) {
  const { mode, state, snapshot, panel, onPanel, onMove } = match;
  const active = snapshot.activeSeat === 0 ? "local" : "opponent";
  const targetId = state.variant === "nine-ball" ? lowestBall(state) : null;

  const statistic = (seat: number) => {
    if (state.variant === "snooker") return state.scores[seat];
    if (state.variant === "nine-ball") {
      const foulCount = state.consecutiveFouls[seat];
      return foulCount ? (
        <Trans comment="九球玩家连续犯规次数，foulCount 为次数。">
          犯规 {foulCount}
        </Trans>
      ) : null;
    }
    return state.groups[seat] === "solids" ? (
      <Trans>全色球</Trans>
    ) : state.groups[seat] === "stripes" ? (
      <Trans>花色球</Trans>
    ) : null;
  };

  const localStats = statistic(0),
    opponentStats = statistic(1);
  return (
    <GameMatchDisplay
      players={{
        local: (
          <>
            <GamePlayerLabel
              identity={mode.kind === "ai" ? "you" : "player1"}
            />
            {localStats !== null ? <> · {localStats}</> : null}
          </>
        ),
        opponent: (
          <>
            {opponentStats !== null ? <>{opponentStats} · </> : null}
            <GamePlayerLabel
              identity={mode.kind === "ai" ? "computer" : "player2"}
            />
          </>
        ),
        active: state.finished ? undefined : active,
        activitySide: active,
        activity: aiThinking ? (
          <GameThinkingIndicator />
        ) : targetId !== null && !state.finished ? (
          <BallIcon id={targetId} potted={false} />
        ) : null,
      }}
      metrics={
        <span>
          <Plural
            value={{ shotNumber: state.shotCount + (state.finished ? 0 : 1) }}
            one="第 # 杆"
            other="第 # 杆"
          />
        </span>
      }
      statusActions={
        state.variant === "snooker" && !state.finished && !aiThinking ? (
          <SnookerTargetControl
            compact
            state={state}
            enabled={target.enabled}
            open={panel === "target"}
            kind={target.kind}
            onKind={target.onKind}
            onOpenChange={(next) => onPanel(next ? "target" : null)}
            onMove={onMove}
          />
        ) : undefined
      }
    />
  );
}
