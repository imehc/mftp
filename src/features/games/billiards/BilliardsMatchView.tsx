/** 对局订阅、规则状态与结果呈现。 */
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { describeError } from "~/lib/errors";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import type { AppError } from "~/types";

import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useMatchSnapshot } from "../engine/match";
import type {
  BilliardsMatchContext,
  BilliardsStageRef,
} from "./billiards-match-view-types";
import { BilliardsActionsBar } from "./BilliardsActionsBar";
import { BilliardsConcedeDialog } from "./BilliardsConcedeDialog";
import type { Session } from "./BilliardsMatch";
import {
  type BilliardsHeaderProps,
  BilliardsMatchHeader,
} from "./BilliardsMatchHeader";
import { BilliardsScoreBar } from "./BilliardsScoreBar";
import { BilliardsStageArea } from "./BilliardsStageArea";
import { BilliardsVictory } from "./BilliardsVictory";
import { useBilliardsPreferences } from "./preferences";
import type { AimTarget } from "./render/scene-contract";
import { type BilliardsPanel, canSubmitRuleMove } from "./rule-panel-state";
import { billiardsSessions } from "./session";
import type { BilliardsMode, BilliardsMove } from "./types";
import { useBilliardsMatchRecord } from "./use-billiards-match-record";
import { useBilliardsNotices } from "./use-billiards-notices";
import { useRulePanel } from "./use-rule-panel";

export function MatchView({
  mode,
  session,
  stageRef,
  onRematch,
  onExit,
  onFinishedChange,
  onStageError,
  stageError,
  headerProps,
}: {
  mode: BilliardsMode;
  session: Session;
  stageRef: BilliardsStageRef;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
  onStageError: (error: unknown) => void;
  /** 渲染阶段错误；与存档提示同处标题栏下方的内容区。 */
  stageError: AppError | null;
  headerProps: BilliardsHeaderProps;
}) {
  const desktop = useDesktopLayout();
  const aimOnly = useBilliardsPreferences((state) => state.aimOnly);
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

  useBilliardsMatchRecord(mode, runner.id, snapshot.winnerSeat, state);

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
  const { panel, setPanel } = useRulePanel(
    state,
    snapshot.moveCount,
    snapshot.phase,
    snapshot.activeSeat,
    activeIsLocal,
  );

  /** 打开面板或执行规则动作前统一取消球桌输入：先停手势，再清零力度预览。 */
  const resetStageInput = () => {
    stageRef.current?.cancelInput();
    setPowerPreview(0);
  };

  const openPanel = (next: BilliardsPanel) => {
    if (next) resetStageInput();
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
  const notices = useBilliardsNotices(state, mode, ballInHand);
  const powerPercent = Math.round(powerPreview * 100);
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);

  // 三个视图共享同一份对局观测值；`state` 保持与 `snapshot.state` 同一引用，
  // 球桌区要靠它和 `runner.getSnapshot().state` 比较「渲染所用状态是否仍然当前」。
  const match: BilliardsMatchContext = {
    mode,
    snapshot,
    state,
    panel,
    canInteract,
    activeIsLocal,
    nominationPending,
    onPanel: openPanel,
    onMove: submitRule,
  };

  return (
    <>
      <BilliardsVictory
        state={state}
        mode={mode}
        winnerSeat={snapshot.winnerSeat}
      />
      <BilliardsMatchHeader
        mode={mode}
        state={state}
        panel={panel === "details" ? "details" : null}
        onPanel={openPanel}
        active
        finished={headerProps.finished}
        landscape={headerProps.landscape}
        onRestart={headerProps.onRestart}
        onExit={headerProps.onExit}
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
          if (next) resetStageInput();
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
      <div className="billiards-session-notice flex shrink-0 flex-col">
        <GameSessionNotice store={billiardsSessions} />
        {stageError ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertDescription>{describeError(stageError)}</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </div>
      <BilliardsScoreBar
        match={match}
        aiThinking={aiThinking}
        desktop={desktop}
        target={{
          enabled:
            activeIsLocal &&
            !selectionReturning &&
            (!selectionBusy || panel === "target"),
          kind: selectionKind,
          onKind: setSelectionKind,
        }}
      />
      <BilliardsStageArea
        match={match}
        session={session}
        menuOpen={menuOpen}
        selection={{
          kind: selectionKind,
          busy: selectionBusy,
          onActive: (active, phase) => {
            setSelectionBusy(active);
            setSelectionReturning(phase === "returning");
          },
        }}
        pushOut={{ value: pushOut, onChange: setPushOut }}
        aim={{ target: aimTarget, onTarget: setAimTarget }}
        onPowerPreview={setPowerPreview}
        followDraw={followDraw}
        aimOnly={aimOnly}
        notices={notices}
        stageRef={stageRef}
        onStageError={onStageError}
      />
      <BilliardsActionsBar
        match={match}
        session={session}
        gates={{
          menuOpen,
          selectionBusy,
          ballInHand,
        }}
        power={{
          followDraw,
          percent: powerPercent,
          onFollowDraw: setFollowDraw,
        }}
        pushOut={pushOut}
        stageRef={stageRef}
        onResetInput={resetStageInput}
        onRematch={onRematch}
        onExit={onExit}
        vertical={headerProps.landscape}
      />
    </>
  );
}
