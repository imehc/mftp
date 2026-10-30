/** 对局页球桌区：规则面板、瞄准分值浮层、短暂提示与球桌本身。 */
import { Trans } from "@lingui/react/macro";

import {
  type LightNoticeMessage,
  LightNoticeStack,
} from "~/components/LightNotice";

import type {
  BilliardsMatchContext,
  BilliardsStageRef,
} from "./billiards-match-view-types";
import type { Session } from "./BilliardsMatch";
import { BilliardsRulePanel } from "./BilliardsRulePanel";
import { equipmentForState } from "./placement";
import { BilliardsStage } from "./render/BilliardsStage";
import type { AimTarget, BallSelectionView } from "./render/scene-contract";
import { snookerValue } from "./snooker-equipment";
import { snookerSelection } from "./snooker-selection";

export function BilliardsStageArea({
  match,
  session,
  menuOpen,
  selection,
  pushOut,
  aim,
  onPowerPreview,
  followDraw,
  aimOnly,
  notices,
  stageRef,
  onStageError,
}: {
  match: BilliardsMatchContext;
  /** 对局实例：球桌需要实时快照做一致性校验，并提交走子。 */
  session: Session;
  /** 标题栏菜单展开时，球桌、瞄准浮层与目标选择都要让位。 */
  menuOpen: boolean;
  /** 斯诺克目标球选择：kind 同时决定高亮集合与提交的走子类型。 */
  selection: {
    kind: "color" | "free";
    busy: boolean;
    /** 球桌选择态回抛；父级持有后供比分条与动作区消费。 */
    onActive(active: boolean, phase: BallSelectionView["phase"] | null): void;
  };
  /** 九球推杆声明；作用域由父级按杆次与座位维护，避免跨杆残留。 */
  pushOut: {
    value: boolean;
    onChange(value: boolean): void;
  };
  /** 球桌回抛的瞄准点与实时力度预览。 */
  aim: {
    target: AimTarget | null;
    onTarget(target: AimTarget | null): void;
  };
  onPowerPreview(power: number): void;
  followDraw: number;
  aimOnly: boolean;
  notices: LightNoticeMessage[];
  stageRef: BilliardsStageRef;
  onStageError(error: unknown): void;
}) {
  const { mode, state, panel, canInteract, activeIsLocal, nominationPending } =
    match;
  const { runner, local } = session;
  const selectionChoices =
    state.variant === "snooker" ? snookerSelection(state) : null;
  const points = aim.target ? snookerValue(aim.target.ballId) : 0;
  return (
    <div
      className="billiards-stage relative z-30 min-h-0 min-w-0 flex-1 overflow-hidden"
      onPointerDown={(event) => {
        if (
          panel === "rules" &&
          event.target instanceof HTMLElement &&
          event.target.hasAttribute("data-billiards-input")
        )
          match.onPanel(null);
      }}
    >
      {state.variant === "snooker" || state.variant === "nine-ball" ? (
        <BilliardsRulePanel
          state={state}
          mode={mode}
          enabled={activeIsLocal}
          panel={panel}
          onPanel={match.onPanel}
          onMove={match.onMove}
          pushOut={pushOut.value}
          onPushOut={(value) => {
            if (runner.getSnapshot().state === state && activeIsLocal)
              pushOut.onChange(value);
          }}
        />
      ) : null}
      {aim.target && panel === null && !menuOpen && canInteract ? (
        <div
          className="billiards-aim-points pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full text-xs font-semibold whitespace-nowrap text-white tabular-nums [text-shadow:0_1px_3px_#000,0_0_2px_#000]"
          style={{
            left: `clamp(1.5rem, ${aim.target.x}%, calc(100% - 1.5rem))`,
            top: `max(1.5rem, calc(${aim.target.y}% - 0.75rem))`,
          }}
        >
          <Trans comment="斯诺克瞄准时首个将碰到的目标球的实际分值">
            {points} 分
          </Trans>
        </div>
      ) : null}

      <LightNoticeStack notices={notices} />
      <BilliardsStage
        ref={stageRef}
        aimOnly={aimOnly}
        resume={
          session.restored || runner.hasStarted || match.snapshot.moveCount > 0
        }
        onReady={() => runner.start()}
        onError={onStageError}
        state={state}
        equipment={equipmentForState(state)}
        interactive={canInteract && panel === null && !menuOpen}
        followDraw={followDraw}
        onPowerPreview={onPowerPreview}
        onAimTarget={aim.onTarget}
        selection={
          panel === "target" && state.variant === "snooker" && selectionChoices
            ? {
                ids:
                  selection.kind === "color"
                    ? selectionChoices.colors
                    : selectionChoices.free,
                selectedId:
                  selection.kind === "color"
                    ? state.on.kind === "color"
                      ? state.on.nominated
                      : null
                    : state.nominatedFree,
              }
            : null
        }
        onSelectionActive={selection.onActive}
        onDismissSelection={() => match.onPanel(null)}
        onSelectedBall={(ballId) => {
          if (
            panel === "target" &&
            match.onMove({
              type: selection.kind === "color" ? "nominate" : "nominate-free",
              ballId,
            })
          )
            match.onPanel(null);
        }}
        onShot={(angle, power) => {
          if (
            !canInteract ||
            panel !== null ||
            menuOpen ||
            selection.busy ||
            state.ballInHand ||
            nominationPending ||
            runner.getSnapshot().state !== state
          )
            return false;
          const declaredPush =
            state.variant === "nine-ball" &&
            state.pushOutAvailable &&
            pushOut.value;
          pushOut.onChange(false);
          return local.submit({
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
  );
}
