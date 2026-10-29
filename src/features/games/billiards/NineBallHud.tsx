import { Trans } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";

import { BallIcon, SeatCell, seatName } from "./BilliardsScore";
import { lowestBall } from "./nine-ball";
import type { BilliardsMode, BilliardsMove, NineBallState } from "./types";

export function NineBallScore({
  state,
  mode,
  activeSeat,
  aiThinking = false,
}: {
  state: NineBallState;
  mode: BilliardsMode;
  activeSeat: number | null;
  /** AI 正在思考时，在其座位徽章处显示旋转指示。 */
  aiThinking?: boolean;
}) {
  const targetId = lowestBall(state);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <SeatCell
        state={state}
        mode={mode}
        seat={0}
        active={activeSeat === 0}
        align="start"
        thinking={aiThinking && activeSeat === 0}
      />
      <div className="flex flex-col items-center gap-1">
        <span className="text-inherit">
          <Trans comment="九球计分栏，必须首先击中的最低号目标球">
            最低目标
          </Trans>
        </span>
        <span className="inline-flex items-center justify-center gap-1">
          {targetId !== null ? <BallIcon id={targetId} potted={false} /> : null}
        </span>
      </div>
      <SeatCell
        state={state}
        mode={mode}
        seat={1}
        active={activeSeat === 1}
        align="end"
        thinking={aiThinking && activeSeat === 1}
      />
    </div>
  );
}

export function NineBallActions({
  state,
  mode,
  enabled,
  pushOut,
  onPushOut,
  onMove,
}: {
  state: NineBallState;
  mode: BilliardsMode;
  enabled: boolean;
  pushOut: boolean;
  onPushOut(value: boolean): void;
  onMove(move: BilliardsMove): void;
}) {
  const decision = state.decision;
  const decisionSeat = decision ? seatName(mode, decision.seat) : null;
  const shooter =
    decision && "shooter" in decision ? seatName(mode, decision.shooter) : null;
  const proposer =
    decision?.kind === "stalemate" ? seatName(mode, decision.proposer) : null;
  return (
    <div className="flex flex-col gap-3 text-xs">
      {decision ? (
        <div className="flex flex-col gap-3">
          <span>
            {decision.kind === "warning" ? (
              <Trans comment="九球两犯警告；decisionSeat 就是被警告的犯规者">
                {decisionSeat} 已连续两次犯规，再次连续犯规将判负。
              </Trans>
            ) : decision.kind === "illegal-break" ? (
              <Trans comment="九球三球开球要求；shooter 是开球者，decisionSeat 是选择接打方式的人">
                {shooter} 未达到三球开球要求。由 {decisionSeat}{" "}
                选择接受桌面或交回 {shooter}；交回后允许推杆。
              </Trans>
            ) : decision.kind === "push-out" ? (
              <Trans comment="九球推杆；shooter 是刚完成推杆的人，decisionSeat 是决策者">
                {shooter} 推杆结束。由 {decisionSeat} 选择接打，或交回 {shooter}
                。
              </Trans>
            ) : (
              <Trans comment="九球僵持协商；proposer 是提议者，decisionSeat 是收到提议的人">
                {proposer} 提议僵持重摆，由 {decisionSeat}{" "}
                决定是否接受。接受后由本局原开球者开球。
              </Trans>
            )}
          </span>
          <div className="flex flex-wrap gap-2 text-shadow-none">
            {decision.kind === "warning" ? (
              <Button
                size="sm"
                disabled={!enabled}
                onClick={() =>
                  onMove({ type: "decision", choice: "acknowledge" })
                }
              >
                <Trans comment="九球两犯警告，确认后继续对局">确认警告</Trans>
              </Button>
            ) : decision.kind === "stalemate" ? (
              <>
                <Button
                  size="sm"
                  disabled={!enabled}
                  onClick={() => onMove({ type: "decision", choice: "rerack" })}
                >
                  <Trans comment="台球僵持协商，接受并重新摆球">同意重摆</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!enabled}
                  onClick={() =>
                    onMove({ type: "decision", choice: "decline" })
                  }
                >
                  <Trans>继续当前球局</Trans>
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  disabled={!enabled}
                  onClick={() => onMove({ type: "decision", choice: "accept" })}
                >
                  <Trans comment="九球推杆或违规开球后，接受当前球位并自己击球">
                    接受桌面
                  </Trans>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!enabled}
                  onClick={() => onMove({ type: "decision", choice: "return" })}
                >
                  <Trans comment="九球推杆或违规开球后，让刚才出杆的人继续击球">
                    交回对方
                  </Trans>
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state.placementRegion ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!enabled || state.ballInHand}
              onClick={() => onMove({ type: "reposition-cue" })}
            >
              <Trans comment="台球手中球权利未消费，重新拖动母球">
                调整母球
              </Trans>
            </Button>
          ) : null}
          {state.pushOutAvailable ? (
            <Button
              size="sm"
              variant={pushOut ? "secondary" : "outline"}
              aria-pressed={pushOut}
              disabled={!enabled}
              onClick={() => onPushOut(!pushOut)}
            >
              {pushOut ? (
                <Trans comment="九球本杆已声明推杆，再按可取消">本杆推杆</Trans>
              ) : (
                <Trans comment="九球合法开球后的一次push-out声明">
                  声明推杆
                </Trans>
              )}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={!enabled}
            onClick={() => onMove({ type: "propose-stalemate" })}
          >
            <Trans comment="台球对局请求双方同意重新摆球">提议重摆</Trans>
          </Button>
          {state.placementRegion === "head" ? (
            <span className="app-description">
              <Trans>开球母球须在头线后，可调整至出杆。</Trans>
            </span>
          ) : null}
          {state.lastOutcome?.respottedNine ? (
            <span role="status">
              <Trans>9 号球已复位</Trans>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
