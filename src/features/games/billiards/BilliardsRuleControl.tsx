import { Trans } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";

import { snookerRuleActions } from "./snooker-rule-actions";
import type { BilliardsState } from "./types";

export function BilliardsRuleControl({
  state,
  enabled,
  open,
  pushOut,
  onOpenChange,
  onReposition,
}: {
  state: BilliardsState;
  enabled: boolean;
  open: boolean;
  pushOut: boolean;
  onOpenChange(open: boolean): void;
  onReposition(): void;
}) {
  const actions =
    state.variant === "snooker" ? snookerRuleActions(state) : null;
  if (state.variant !== "nine-ball" && !actions?.reposition && !actions?.claim)
    return null;
  const directReposition = !!actions?.reposition && !actions.claim;
  return (
    <Button
      size="sm"
      density="adaptive"
      variant="outline"
      className="billiards-rule-trigger"
      aria-haspopup={directReposition ? undefined : "dialog"}
      aria-expanded={directReposition ? undefined : open}
      disabled={!enabled}
      onClick={() => {
        if (directReposition) onReposition();
        else onOpenChange(!open);
      }}
    >
      {directReposition ? (
        <Trans>调整母球</Trans>
      ) : pushOut ? (
        <Trans>本杆推杆</Trans>
      ) : (
        <Trans>操作</Trans>
      )}
    </Button>
  );
}
