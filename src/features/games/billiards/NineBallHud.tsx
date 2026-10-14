import { Trans } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";

import { BallIcon, SeatCell, seatName } from "./BilliardsScore";
import { lowestBall } from "./nine-ball";
import type { BilliardsMode, BilliardsMove, NineBallState } from "./types";

export function NineBallScore({
  state,
  mode,
  activeSeat,
}: {
  state: NineBallState;
  mode: BilliardsMode;
  activeSeat: number | null;
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
  return (
    <div className="flex flex-col gap-3 text-xs">
      {decision ? (
        <div className="flex flex-col gap-3">
          <span>
            {decisionSeat}
            {" · "}
            {decision.kind === "warning" ? (
              <Trans>已连续两次犯规，再次连续犯规将判负。</Trans>
            ) : decision.kind === "illegal-break" ? (
              <Trans>
                未达到三球开球要求。可接受桌面或交回开球者；交回后允许推杆。
              </Trans>
            ) : decision.kind === "push-out" ? (
              <Trans>推杆结束。可自己接打，或交回推杆者。</Trans>
            ) : (
              <Trans>对方提议僵持重摆。接受后由本局原开球者开球。</Trans>
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
            <span className="text-muted-foreground">
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
