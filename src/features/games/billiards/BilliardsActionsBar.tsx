/** 对局页底部动作区：结算按钮、待处理提示与击球控件三选一。 */
import { Trans } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";

import type {
  BilliardsMatchContext,
  BilliardsStageRef,
} from "./billiards-match-view-types";
import { BilliardsControls } from "./BilliardsControls";
import { BilliardsDecisionNotice } from "./BilliardsDecisionNotice";
import type { Session } from "./BilliardsMatch";
import { BilliardsRuleControl } from "./BilliardsRuleControl";
import { canSubmitRuleMove } from "./rule-panel-state";

export function BilliardsActionsBar({
  match,
  session,
  gates,
  power,
  pushOut,
  stageRef,
  onResetInput,
  onRematch,
  onExit,
  vertical,
}: {
  match: BilliardsMatchContext;
  /** 待处理入口重新展开弹窗前，需要 runner 的实时快照做一致性校验。 */
  session: Session;
  /** 任一为真都让底部控件不可交互：菜单展开、球桌选择中、需先放置母球。 */
  gates: {
    menuOpen: boolean;
    selectionBusy: boolean;
    ballInHand: boolean;
  };
  power: {
    followDraw: number;
    /** 当前力度预览的百分比，已四舍五入。 */
    percent: number;
    onFollowDraw(value: number): void;
  };
  /** 仅供规则入口显示「本杆推杆」状态，写入仍由球桌区负责。 */
  pushOut: boolean;
  stageRef: BilliardsStageRef;
  /** 规则动作开始前统一取消球桌输入并清零力度预览。 */
  onResetInput(): void;
  onRematch(): void;
  onExit(): void;
  /** 横屏时力度条与控件竖排。 */
  vertical: boolean;
}) {
  const { state, snapshot, panel, activeIsLocal, onPanel, onMove } = match;
  const { runner } = session;
  const decisionPending =
    (state.variant === "snooker" || state.variant === "nine-ball") &&
    !!state.decision;
  return (
    <div className="billiards-actions">
      {state.finished ? (
        <div className="billiards-result flex h-full items-center justify-center gap-2 px-2">
          <Button size="sm" density="adaptive" onClick={onRematch}>
            <Trans>再来一局</Trans>
          </Button>
          <Button size="sm" density="adaptive" variant="ghost" onClick={onExit}>
            <Trans>退出</Trans>
          </Button>
        </div>
      ) : decisionPending && activeIsLocal ? (
        <BilliardsDecisionNotice
          foul={state.variant === "snooker" && state.decision?.kind === "foul"}
          open={panel === "rules"}
          onOpen={() => {
            if (
              canSubmitRuleMove(snapshot, runner.getSnapshot(), activeIsLocal)
            )
              onPanel("rules");
          }}
        />
      ) : (
        <BilliardsControls
          followDraw={power.followDraw}
          onFollowDraw={power.onFollowDraw}
          power={power.percent}
          vertical={vertical}
          turn={snapshot.moveCount}
          shotInput={{
            beginPowerShot: () => stageRef.current?.beginPowerShot() ?? false,
            updateShotPower: (value) =>
              stageRef.current?.updateShotPower(value) ?? false,
            releasePowerShot: () => stageRef.current?.releasePowerShot(),
            cancelPowerShot: () => stageRef.current?.cancelPowerShot(),
          }}
          interactive={
            match.canInteract &&
            panel === null &&
            !gates.menuOpen &&
            !gates.selectionBusy &&
            !gates.ballInHand &&
            !match.nominationPending
          }
          action={
            <BilliardsRuleControl
              state={state}
              enabled={
                activeIsLocal &&
                !gates.menuOpen &&
                !gates.selectionBusy &&
                (panel === null || panel === "rules")
              }
              open={panel === "rules"}
              pushOut={pushOut}
              onOpenChange={(open) => onPanel(open ? "rules" : null)}
              onReposition={() => {
                onResetInput();
                onMove({ type: "reposition-cue" });
              }}
              onProposeStalemate={() => {
                onResetInput();
                onMove({ type: "propose-stalemate" });
              }}
            />
          }
        />
      )}
    </div>
  );
}
