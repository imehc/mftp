import { Trans } from "@lingui/react/macro";

import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import { NineBallActions } from "./NineBallHud";
import type { BilliardsPanel } from "./rule-panel-state";
import { SnookerActions } from "./SnookerHud";
import type {
  BilliardsMode,
  BilliardsMove,
  NineBallState,
  SnookerState,
} from "./types";

export function BilliardsRulePanel({
  state,
  mode,
  enabled,
  panel,
  onPanel,
  onMove,
  pushOut,
  onPushOut,
}: {
  state: SnookerState | NineBallState;
  mode: BilliardsMode;
  enabled: boolean;
  panel: BilliardsPanel;
  onPanel(panel: BilliardsPanel): void;
  onMove(move: BilliardsMove): boolean;
  pushOut: boolean;
  onPushOut(value: boolean): void;
}) {
  const open = panel === "rules";

  const submit = (move: BilliardsMove) => {
    if (onMove(move)) onPanel(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onPanel(null);
      }}
    >
      <DialogLayoutContent
        data-rule-panel
        placement="responsive-sheet"
        showCloseButton={false}
        className="md:max-w-md"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // 选择完成后待处理入口会卸载，回到仍存在的操作入口。
          const trigger =
            document.querySelector<HTMLButtonElement>(
              ".billiards-game [data-rule-pending], .billiards-game .billiards-rule-trigger:not(:disabled)",
            ) ??
            document.querySelector<HTMLButtonElement>(
              ".billiards-game [data-game-more]",
            );
          trigger?.focus();
        }}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            {state.variant === "snooker" && state.decision?.kind === "foul" ? (
              <Trans comment="斯诺克犯规后选择接打或重打的弹层标题">
                犯规处理
              </Trans>
            ) : (
              <Trans comment="台球规则相关操作弹层标题">规则操作</Trans>
            )}
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          {state.variant === "snooker" ? (
            <SnookerActions
              state={state}
              mode={mode}
              enabled={enabled}
              onMove={submit}
            />
          ) : (
            <NineBallActions
              state={state}
              mode={mode}
              enabled={enabled}
              pushOut={pushOut}
              onPushOut={(value) => {
                onPushOut(value);
                onPanel(null);
              }}
              onMove={submit}
            />
          )}
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
