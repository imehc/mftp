/** 对局订阅、规则状态与结果呈现。 */
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import { GameResultBar } from "../engine/GameResultBar";
import { useGamesHistoryStore } from "../engine/history";
import { useMatchSnapshot } from "../engine/match";
import { BilliardsControls } from "./BilliardsControls";
import type { Session } from "./BilliardsMatch";
import { BallTray, SeatCell, seatName, seatTray } from "./BilliardsScore";
import { NineBallActions, NineBallScore } from "./NineBallHud";
import { equipmentForState } from "./placement";
import {
  BilliardsStage,
  type BilliardsStageHandle,
} from "./render/BilliardsStage";
import { SnookerActions, SnookerScore } from "./SnookerHud";
import {
  BILLIARDS_GAME_ID,
  type BilliardsHistoryPayload,
  type BilliardsMode,
  type FoulReason,
} from "./types";

function foulLabel(foul: FoulReason) {
  switch (foul) {
    case "wrong-ball-potted":
      return <Trans>犯规：打进非目标球</Trans>;
    case "touching-ball-moved":
      return <Trans>犯规：推动贴球</Trans>;
    case "snooker-behind-nomination":
      return <Trans>犯规：用指定球做障碍</Trans>;
    case "cue-potted":
      return <Trans>犯规：母球落袋</Trans>;
    case "no-contact":
      return <Trans>犯规：未碰到任何球</Trans>;
    case "wrong-first-contact":
      return <Trans>犯规：未先碰到合法目标球</Trans>;
    case "no-rail":
      return <Trans>犯规：未进球且首碰后无球碰库</Trans>;
    case "illegal-break":
      return <Trans>犯规：开球无进球且不足四个目标球碰库</Trans>;
    case "potted-eight-early":
      return <Trans>犯规：提前打进黑八</Trans>;
  }
}

export function MatchView({
  mode,
  session,
  stageRef,
  onRematch,
  onExit,
  onFinishedChange,
  onStageError,
}: {
  mode: BilliardsMode;
  session: Session;
  stageRef: {
    current: BilliardsStageHandle | null;
  };
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
  onStageError: (error: unknown) => void;
}) {
  const desktop = useDesktopLayout();
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const [followDraw, setFollowDraw] = useState(0);
  const [powerPreview, setPowerPreview] = useState(0);
  const [pushOut, setPushOut] = useState(false);
  const addRecord = useGamesHistoryStore((s) => s.addRecord);
  const recordedRef = useRef(false);

  // 每场已结束的对局只持久化一条历史记录。
  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: crypto.randomUUID(),
      gameId: BILLIARDS_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        version: 2,
        discipline: mode.discipline ?? "eight-ball",
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: snapshot.winnerSeat,
        shots: state.shotCount,
        fouls: state.foulCounts,
        reds: mode.discipline === "snooker" ? mode.reds : undefined,
        scores: state.variant === "snooker" ? state.scores : undefined,
        highestBreaks:
          state.variant === "snooker" ? state.highestBreaks : undefined,
      } satisfies BilliardsHistoryPayload,
    });
    // 上面的 recordedRef 保证只记录一条；这里的每个依赖项在本 keyed
    // 对局实例的整个生命周期内都是稳定的。
  }, [addRecord, mode, snapshot.winnerSeat, state]);
  const activeIsLocal =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "local";
  const aiThinking =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "ai";
  const decisionPending =
    (state.variant === "snooker" || state.variant === "nine-ball") &&
    !!state.decision;
  const nominationPending =
    state.variant === "snooker" &&
    state.on.kind === "color" &&
    state.on.nominated === null;
  const canInteract =
    activeIsLocal &&
    !decisionPending &&
    (!nominationPending || state.ballInHand);
  const ballInHand = canInteract && state.ballInHand;
  const outcome = state.lastOutcome;
  const remaining = state.balls.filter(
    (ball) => !ball.potted && ball.id !== 0,
  ).length;
  const powerPercent = Math.round(powerPreview * 100);
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);
  // 两处渲染点都由 `snapshot.winnerSeat !== null` 保护。
  const winnerSeatLabel =
    snapshot.winnerSeat !== null ? seatName(mode, snapshot.winnerSeat) : "";
  return (
    <>
      <div
        data-rules={
          state.variant === "snooker" || state.variant === "nine-ball"
        }
        className="billiards-score min-h-8 shrink-0 px-3 py-2 text-xs"
      >
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
        ) : mode.kind === "practice" ? (
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
        ) : state.variant === "snooker" ? (
          <SnookerScore
            state={state}
            mode={mode}
            activeSeat={snapshot.activeSeat}
          />
        ) : state.variant === "nine-ball" ? (
          <NineBallScore
            state={state}
            mode={mode}
            activeSeat={snapshot.activeSeat}
          />
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <SeatCell
              mode={mode}
              state={state}
              seat={0}
              active={snapshot.activeSeat === 0}
              align="start"
            />
            <div className="flex max-w-[50vw] flex-wrap items-center justify-center gap-1.5">
              <Badge variant="outline">
                <Plural
                  value={{
                    shotNumber: state.shotCount + 1,
                  }}
                  one="第 # 杆"
                  other="第 # 杆"
                />
              </Badge>
            </div>
            <SeatCell
              mode={mode}
              state={state}
              seat={1}
              active={snapshot.activeSeat === 1}
              align="end"
            />
          </div>
        )}
      </div>

      <div className="billiards-stage relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="billiards-status" role="status" aria-live="polite">
          <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center text-xs">
            {outcome?.foul ? (
              <span className="text-destructive">
                {foulLabel(outcome.foul)}
              </span>
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
            ) : outcome?.respottedEight ? (
              <span className="text-muted-foreground">
                <Trans>黑八已重置</Trans>
              </span>
            ) : null}
          </div>
        </div>

        <BilliardsStage
          ref={stageRef}
          onReady={() => runner.start()}
          onError={onStageError}
          state={state}
          equipment={equipmentForState(state)}
          interactive={canInteract}
          followDraw={followDraw}
          onPowerPreview={setPowerPreview}
          onShot={(angle, power) => {
            if (!canInteract || state.ballInHand || nominationPending) return;
            const declaredPush =
              state.variant === "nine-ball" &&
              state.pushOutAvailable &&
              pushOut;
            setPushOut(false);
            local.submit({
              type: "shot",
              pushOut: declaredPush,
              angle,
              power,
              followDraw,
            });
          }}
          onPlaceCue={(x, y) => {
            local.submit({
              type: "place-cue",
              x,
              y,
            });
          }}
        />
      </div>
      <div
        className="billiards-actions"
        data-rules={
          (state.variant === "nine-ball" || state.variant === "snooker") &&
          !state.finished
        }
      >
        {state.variant === "snooker" && !state.finished ? (
          <SnookerActions
            state={state}
            mode={mode}
            enabled={activeIsLocal}
            onMove={(move) => local.submit(move)}
          />
        ) : null}
        {state.variant === "nine-ball" && !state.finished ? (
          <NineBallActions
            state={state}
            mode={mode}
            enabled={activeIsLocal}
            pushOut={pushOut}
            onPushOut={setPushOut}
            onMove={(move) => {
              setPushOut(false);
              local.submit(move);
            }}
          />
        ) : null}
        {state.finished ? (
          <div className="billiards-result shrink-0">
            <GameResultBar
              presentation="actions"
              title={
                state.variant === "practice" ? (
                  <Trans>清台完成！</Trans>
                ) : snapshot.winnerSeat !== null ? (
                  <Trans>{winnerSeatLabel} 获胜</Trans>
                ) : (
                  <Trans>对局结束</Trans>
                )
              }
              celebrate={
                state.variant === "practice" ||
                (snapshot.winnerSeat !== null &&
                  (mode.kind === "hotseat" ||
                    (mode.kind === "ai" && snapshot.winnerSeat === 0)))
              }
              details={
                <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 md:justify-start">
                  <Plural
                    value={{
                      shotCount: state.shotCount,
                    }}
                    one="总杆数 #"
                    other="总杆数 #"
                  />
                  {mode.kind !== "practice"
                    ? [0, 1].map((seat) => {
                        const tray = seatTray(state, seat);
                        return (
                          <span
                            key={seat}
                            className="inline-flex items-center gap-1.5"
                          >
                            {seatName(mode, seat)}
                            {state.variant === "snooker" ? (
                              <span>
                                <Trans>
                                  得分 {state.scores[seat]}，最高单杆{" "}
                                  {state.highestBreaks[seat]}
                                </Trans>
                              </span>
                            ) : null}
                            {tray ? (
                              <BallTray state={state} ids={tray} />
                            ) : null}
                            <Plural
                              value={{
                                foulCount: state.foulCounts[seat] ?? 0,
                              }}
                              one="犯规 # 次"
                              other="犯规 # 次"
                            />
                          </span>
                        );
                      })
                    : null}
                </span>
              }
              onRematch={onRematch}
              onExit={onExit}
            />
          </div>
        ) : decisionPending ? null : (
          <BilliardsControls
            followDraw={followDraw}
            onFollowDraw={setFollowDraw}
            power={powerPercent}
            interactive={canInteract && !ballInHand && !nominationPending}
          />
        )}
      </div>
    </>
  );
}
