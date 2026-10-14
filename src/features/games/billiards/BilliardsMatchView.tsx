/** 对局订阅、规则状态与结果呈现。 */
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useGamesHistoryStore } from "../engine/history";
import { useMatchSnapshot } from "../engine/match";
import { BilliardsConcedeDialog } from "./BilliardsConcedeDialog";
import { BilliardsControls } from "./BilliardsControls";
import { BilliardsDecisionNotice } from "./BilliardsDecisionNotice";
import { BilliardsDetails } from "./BilliardsDetails";
import { BilliardsHeader, type BilliardsHeaderProps } from "./BilliardsHeader";
import type { Session } from "./BilliardsMatch";
import { BilliardsRuleControl } from "./BilliardsRuleControl";
import { BilliardsRulePanel } from "./BilliardsRulePanel";
import { BallTray, SeatCell, seatName } from "./BilliardsScore";
import { BilliardsVictory } from "./BilliardsVictory";
import { NineBallScore } from "./NineBallHud";
import { equipmentForState } from "./placement";
import {
  BilliardsStage,
  type BilliardsStageHandle,
} from "./render/BilliardsStage";
import type { AimTarget } from "./render/scene-contract";
import { type BilliardsPanel, canSubmitRuleMove } from "./rule-panel-state";
import { billiardsSessions } from "./session";
import { snookerValue } from "./snooker-equipment";
import { snookerSelection } from "./snooker-selection";
import { SnookerScore } from "./SnookerHud";
import { SnookerTargetControl } from "./SnookerTargetControl";
import {
  BILLIARDS_GAME_ID,
  type BilliardsHistoryPayload,
  type BilliardsMode,
  type BilliardsMove,
  type FoulReason,
} from "./types";
import { useRulePanel } from "./use-rule-panel";

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
  headerProps,
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
  headerProps: BilliardsHeaderProps;
}) {
  const desktop = useDesktopLayout();
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const [followDraw, setFollowDraw] = useState(0);
  const [powerPreview, setPowerPreview] = useState(0);
  const [aimTarget, setAimTarget] = useState<AimTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionReturning, setSelectionReturning] = useState(false);
  const [storedSelectionKind, setSelectionKind] = useState<"color" | "free">(
    "color",
  );
  const pushScope = `${state.shotCount}:${state.turnSeat}`;
  const [pushDeclaration, setPushDeclaration] = useState({
    scope: "",
    value: false,
  });
  const pushOut = pushDeclaration.scope === pushScope && pushDeclaration.value;
  const setPushOut = (value: boolean) =>
    setPushDeclaration({ scope: pushScope, value });
  const addRecord = useGamesHistoryStore((s) => s.addRecord);
  const recordedRef = useRef(false);

  // 每场已结束的对局只持久化一条历史记录。
  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: runner.id,
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
  }, [addRecord, mode, runner.id, snapshot.winnerSeat, state]);
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
  const selectionKind = nominationPending ? "color" : storedSelectionKind;
  const selectionChoices =
    state.variant === "snooker" ? snookerSelection(state) : null;
  const { panel, setPanel } = useRulePanel(
    state,
    snapshot.moveCount,
    snapshot.phase,
    snapshot.activeSeat,
    activeIsLocal,
  );

  const openPanel = (next: BilliardsPanel) => {
    if (next) {
      stageRef.current?.cancelInput();
      setPowerPreview(0);
    }
    setPanel(next);
  };

  useEffect(() => {
    if (panel !== "target" && panel !== "rules") return;

    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setPanel(null);
      }
    };

    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [panel, setPanel]);

  const submitRule = (move: BilliardsMove) => {
    const current = runner.getSnapshot();
    if (!canSubmitRuleMove(snapshot, current, activeIsLocal)) return false;
    setPushOut(false);
    return local.submit(move);
  };

  const ballInHand = canInteract && state.ballInHand;
  const outcome = state.lastOutcome;
  const remaining = state.balls.filter(
    (ball) => !ball.potted && ball.id !== 0,
  ).length;
  const powerPercent = Math.round(powerPreview * 100);
  const points = aimTarget ? snookerValue(aimTarget.ballId) : 0;
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);
  // 两处渲染点都由 `snapshot.winnerSeat !== null` 保护。
  const winnerSeatLabel =
    snapshot.winnerSeat !== null ? seatName(mode, snapshot.winnerSeat) : "";
  return (
    <>
      <BilliardsVictory
        state={state}
        mode={mode}
        winnerSeat={snapshot.winnerSeat}
      />
      <BilliardsHeader
        {...headerProps}
        details={
          <BilliardsDetails
            state={state}
            mode={mode}
            open={panel === "details"}
            onOpenChange={(next) => openPanel(next ? "details" : null)}
          />
        }
        canConcede={activeIsLocal && !state.finished}
        onConcede={
          state.variant === "snooker" && !state.finished
            ? () => {
                if (
                  canSubmitRuleMove(
                    snapshot,
                    runner.getSnapshot(),
                    activeIsLocal,
                  )
                )
                  openPanel("concede");
              }
            : undefined
        }
        onMenuOpenChange={(next) => {
          setMenuOpen(next);
          if (next) {
            stageRef.current?.cancelInput();
            setPowerPreview(0);
          }
        }}
      />
      <BilliardsConcedeDialog
        open={panel === "concede"}
        enabled={
          activeIsLocal && state.variant === "snooker" && !state.finished
        }
        onOpenChange={(next) => {
          if (!next) openPanel(null);
        }}
        onConcede={() => {
          if (submitRule({ type: "concede" })) openPanel(null);
        }}
      />
      <div className="billiards-score shrink-0 text-xs">
        <GameSessionNotice store={billiardsSessions} />
        <div className="billiards-summary mx-auto w-full max-w-6xl min-w-0 px-3 md:px-4">
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
              target={
                <SnookerTargetControl
                  state={state}
                  enabled={
                    activeIsLocal &&
                    !selectionReturning &&
                    (!selectionBusy || panel === "target")
                  }
                  open={panel === "target"}
                  kind={selectionKind}
                  onKind={setSelectionKind}
                  onOpenChange={(next) => openPanel(next ? "target" : null)}
                  onMove={submitRule}
                />
              }
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
      </div>

      <div
        className="billiards-stage relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden"
        onPointerDown={(event) => {
          if (panel === "rules" && event.target instanceof HTMLCanvasElement)
            openPanel(null);
        }}
      >
        {state.variant === "snooker" || state.variant === "nine-ball" ? (
          <BilliardsRulePanel
            state={state}
            mode={mode}
            enabled={activeIsLocal}
            panel={panel}
            onPanel={openPanel}
            onMove={submitRule}
            pushOut={pushOut}
            onPushOut={(value) => {
              if (runner.getSnapshot().state === state && activeIsLocal)
                setPushOut(value);
            }}
          />
        ) : null}
        {aimTarget && panel === null && !menuOpen && canInteract ? (
          <div
            className="billiards-aim-points pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full text-xs font-semibold whitespace-nowrap text-white tabular-nums [text-shadow:0_1px_3px_#000,0_0_2px_#000]"
            style={{
              left: `clamp(1.5rem, ${aimTarget.x}%, calc(100% - 1.5rem))`,
              top: `max(1.5rem, calc(${aimTarget.y}% - 0.75rem))`,
            }}
          >
            <Trans comment="斯诺克瞄准时首个将碰到的目标球的实际分值">
              {points} 分
            </Trans>
          </div>
        ) : null}
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
          resume={
            session.restored || runner.hasStarted || snapshot.moveCount > 0
          }
          onReady={() => runner.start()}
          onError={onStageError}
          state={state}
          equipment={equipmentForState(state)}
          interactive={canInteract && panel === null && !menuOpen}
          followDraw={followDraw}
          onPowerPreview={setPowerPreview}
          onAimTarget={setAimTarget}
          selection={
            panel === "target" &&
            state.variant === "snooker" &&
            selectionChoices
              ? {
                  ids:
                    selectionKind === "color"
                      ? selectionChoices.colors
                      : selectionChoices.free,
                  selectedId:
                    selectionKind === "color"
                      ? state.on.kind === "color"
                        ? state.on.nominated
                        : null
                      : state.nominatedFree,
                }
              : null
          }
          onSelectionActive={(active, phase) => {
            setSelectionBusy(active);
            setSelectionReturning(phase === "returning");
          }}
          onDismissSelection={() => openPanel(null)}
          onSelectedBall={(ballId) => {
            if (
              panel === "target" &&
              submitRule({
                type: selectionKind === "color" ? "nominate" : "nominate-free",
                ballId,
              })
            )
              openPanel(null);
          }}
          onShot={(angle, power) => {
            if (
              !canInteract ||
              panel !== null ||
              menuOpen ||
              selectionBusy ||
              state.ballInHand ||
              nominationPending ||
              runner.getSnapshot().state !== state
            )
              return;
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
            if (
              !canInteract ||
              panel !== null ||
              menuOpen ||
              runner.getSnapshot().state !== state
            )
              return;
            local.submit({
              type: "place-cue",
              x,
              y,
            });
          }}
        />
      </div>
      <div className="billiards-actions">
        {state.finished ? (
          <div className="billiards-result flex h-full items-center justify-center gap-2 px-2">
            <Button size="sm" density="adaptive" onClick={onRematch}>
              <Trans>再来一局</Trans>
            </Button>
            <Button
              size="sm"
              density="adaptive"
              variant="ghost"
              onClick={onExit}
            >
              <Trans>退出</Trans>
            </Button>
          </div>
        ) : decisionPending && activeIsLocal ? (
          <BilliardsDecisionNotice
            foul={
              state.variant === "snooker" && state.decision?.kind === "foul"
            }
            open={panel === "rules"}
            onOpen={() => {
              if (
                canSubmitRuleMove(snapshot, runner.getSnapshot(), activeIsLocal)
              )
                openPanel("rules");
            }}
          />
        ) : (
          <BilliardsControls
            followDraw={followDraw}
            onFollowDraw={setFollowDraw}
            power={powerPercent}
            interactive={
              canInteract &&
              panel === null &&
              !menuOpen &&
              !selectionBusy &&
              !ballInHand &&
              !nominationPending
            }
            action={
              <BilliardsRuleControl
                state={state}
                enabled={
                  activeIsLocal &&
                  !menuOpen &&
                  !selectionBusy &&
                  (panel === null || panel === "rules")
                }
                open={panel === "rules"}
                pushOut={pushOut}
                onOpenChange={(open) => openPanel(open ? "rules" : null)}
                onReposition={() => {
                  stageRef.current?.cancelInput();
                  setPowerPreview(0);
                  submitRule({ type: "reposition-cue" });
                }}
              />
            }
          />
        )}
      </div>
    </>
  );
}
