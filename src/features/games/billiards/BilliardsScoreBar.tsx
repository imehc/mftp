/** 对局页比分条：按玩法切换练习、斯诺克、九球与八球的计分呈现。 */
import { Plural, Trans } from "@lingui/react/macro";

import { Badge } from "~/components/ui/badge";

import { GameDisplayBar } from "../engine/GameToolbar";
import type { BilliardsMatchContext } from "./billiards-match-view-types";
import { BilliardsMatchScore } from "./BilliardsMatchScore";
import { BallTray, seatName } from "./BilliardsScore";

export function BilliardsScoreBar({
  match,
  aiThinking,
  desktop,
  target,
}: {
  match: BilliardsMatchContext;
  /** AI 回合进行中：对应座位徽章显示旋转指示。 */
  aiThinking: boolean;
  /** 桌面端才在练习分支展示球托盘，移动端由球桌自身表达。 */
  desktop: boolean;
  /** 斯诺克目标球选择器；enabled 由调用方按选择态与面板态算好。 */
  target: {
    enabled: boolean;
    kind: "color" | "free";
    onKind(kind: "color" | "free"): void;
  };
}) {
  const { mode, state, snapshot } = match;
  const remaining = state.balls.filter(
    (ball) => !ball.potted && ball.id !== 0,
  ).length;
  // 下面两处渲染点都由 `snapshot.winnerSeat !== null` 保护。
  const winnerSeatLabel =
    snapshot.winnerSeat !== null ? seatName(mode, snapshot.winnerSeat) : "";
  if (mode.kind !== "practice") {
    return (
      <GameDisplayBar className="billiards-score text-xs">
        <div className="billiards-summary w-full min-w-0" data-match>
          <BilliardsMatchScore
            match={match}
            aiThinking={aiThinking}
            target={target}
          />
        </div>
      </GameDisplayBar>
    );
  }
  return (
    <GameDisplayBar className="billiards-score text-xs">
      <div className="billiards-summary w-full min-w-0">
        {state.finished ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant="secondary">
              {state.variant === "practice" ? (
                <Trans>清台完成！</Trans>
              ) : snapshot.winnerSeat !== null ? (
                <Trans>{winnerSeatLabel} 获胜</Trans>
              ) : (
                <Trans>对局结束</Trans>
              )}
            </Badge>
            <Badge variant="outline">
              <Plural
                value={{
                  shotCount: state.shotCount,
                }}
                one="共 # 杆"
                other="共 # 杆"
              />
            </Badge>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant="outline">
              <Plural
                value={{
                  shotNumber: state.shotCount + 1,
                }}
                one="第 # 杆"
                other="第 # 杆"
              />
            </Badge>
            <Badge variant="outline">
              <Plural
                value={{
                  remainingBallCount: remaining,
                }}
                one="剩余 # 球"
                other="剩余 # 球"
              />
            </Badge>
            {desktop ? (
              <BallTray
                state={state}
                ids={state.balls
                  .filter((ball) => ball.id)
                  .map((ball) => ball.id)}
              />
            ) : null}
          </div>
        )}
      </div>
    </GameDisplayBar>
  );
}
