/**
 * 对局装配与视图：为所选模式构建 MatchRunner，并渲染 HUD（座位单元、
 * 球托盘、犯规提示）、Pixi 舞台、非模态结果条，以及旋转/力度底栏。
 */
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import { AiController, LocalController } from "../engine/controllers";
import { GameResultBar } from "../engine/GameResultBar";
import { useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import type { PlayerController } from "../engine/types";
import { billiardsAiStrategy } from "./ai";
import { BilliardsControls } from "./BilliardsControls";
import {
  ALL_TRAY,
  BallTray,
  SeatCell,
  seatName,
  seatTray,
} from "./BilliardsScore";
import {
  BilliardsStage,
  type BilliardsStageHandle,
} from "./render/BilliardsStage";
import { createBilliardsGame, createInitialState } from "./rules";
import {
  BILLIARDS_GAME_ID,
  type BilliardsHistoryPayload,
  type BilliardsMode,
  type BilliardsMove,
  type BilliardsPresentation,
  type BilliardsState,
  type FoulReason,
} from "./types";

interface Session {
  runner: MatchRunner<BilliardsState, BilliardsMove, BilliardsPresentation>;
  local: LocalController<BilliardsState, BilliardsMove>;
}

function foulLabel(foul: FoulReason) {
  switch (foul) {
    case "cue-potted":
      return <Trans>犯规：母球落袋</Trans>;
    case "no-contact":
      return <Trans>犯规：未碰到任何球</Trans>;
    case "wrong-first-contact":
      return <Trans>犯规：首先碰到的不是本方球</Trans>;
    case "potted-eight-early":
      return <Trans>犯规：提前打进黑八</Trans>;
  }
}

export function BilliardsMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: BilliardsMode;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const stageRef = useRef<BilliardsStageHandle | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const variant = mode.kind === "practice" ? "practice" : "eight-ball";
    const game = createBilliardsGame(variant);
    const local = new LocalController<BilliardsState, BilliardsMove>();
    const controllers: PlayerController<BilliardsState, BilliardsMove>[] =
      mode.kind === "practice"
        ? [local]
        : mode.kind === "hotseat"
          ? [local, local]
          : [local, new AiController(billiardsAiStrategy, mode.difficulty)];
    const runner = new MatchRunner(
      game,
      createInitialState(
        variant,
        mode.kind === "ai" && !mode.playerBreaks ? 1 : 0,
      ),
      controllers,
      {
        onMoveResolved: async ({ seat, move, resolution }) => {
          if (move.type === "shot" && controllers[seat]?.kind === "ai") {
            await stageRef.current?.animateAiCue(move.angle, move.power);
          }
          await stageRef.current?.playPresentation(resolution.presentation);
        },
        onError: (error) => console.error("billiards match error", error),
      },
    );
    runner.start();
    // 用微任务延迟，使 setState 发生在 effect 主体之外；cancelled 标记
    // 用于防止严格模式重挂载时发布已被销毁的 runner。
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        setSession({
          runner,
          local,
        });
    });
    return () => {
      cancelled = true;
      runner.dispose();
      setSession(null);
    };
    // 每个 <BilliardsMatch key=...> 实例的 mode 标识是稳定的。
  }, [mode]);
  if (!session) return <div className="flex-1" />;
  return (
    <MatchView
      mode={mode}
      session={session}
      stageRef={stageRef}
      onRematch={onRematch}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
    />
  );
}

function MatchView({
  mode,
  session,
  stageRef,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: BilliardsMode;
  session: Session;
  stageRef: {
    current: BilliardsStageHandle | null;
  };
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const desktop = useDesktopLayout();
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const [followDraw, setFollowDraw] = useState(0);
  const [powerPreview, setPowerPreview] = useState(0);
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
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: snapshot.winnerSeat,
        shots: state.shotCount,
        fouls: state.foulCounts,
      } satisfies BilliardsHistoryPayload,
    });
    // 上面的 recordedRef 保证只记录一条；这里的每个依赖项在本 keyed
    // 对局实例的整个生命周期内都是稳定的。
  }, [
    addRecord,
    mode,
    snapshot.winnerSeat,
    state.finished,
    state.shotCount,
    state.foulCounts,
  ]);
  const activeIsLocal =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "local";
  const aiThinking =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "ai";
  const ballInHand = activeIsLocal && state.ballInHand;
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
      <div className="billiards-score min-h-8 shrink-0 px-3 py-2 text-xs">
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
            {desktop ? <BallTray state={state} ids={ALL_TRAY} /> : null}
            {outcome?.foul ? (
              <Badge variant="destructive">{foulLabel(outcome.foul)}</Badge>
            ) : null}
          </div>
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
              {aiThinking ? (
                <Badge variant="outline">
                  <Trans>AI 思考中…</Trans>
                </Badge>
              ) : null}
              {ballInHand ? (
                <Badge variant="secondary">
                  <Trans>自由球：拖动母球放置</Trans>
                </Badge>
              ) : null}
              {outcome?.foul ? (
                <Badge variant="destructive">{foulLabel(outcome.foul)}</Badge>
              ) : null}
              {outcome?.respottedEight ? (
                <Badge variant="outline">
                  <Trans>黑八已重置</Trans>
                </Badge>
              ) : null}
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
        <BilliardsStage
          ref={stageRef}
          balls={state.balls}
          interactive={activeIsLocal}
          ballInHand={ballInHand}
          followDraw={followDraw}
          onPowerPreview={setPowerPreview}
          onShot={(angle, power) => {
            if (!activeIsLocal || state.ballInHand) return;
            local.submit({
              type: "shot",
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
      {state.finished ? (
        <div className="billiards-result shrink-0">
          <GameResultBar
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
                          {tray ? <BallTray state={state} ids={tray} /> : null}
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
      ) : (
        <BilliardsControls
          followDraw={followDraw}
          onFollowDraw={setFollowDraw}
          power={powerPercent}
          interactive={activeIsLocal && !ballInHand}
        />
      )}
    </>
  );
}
