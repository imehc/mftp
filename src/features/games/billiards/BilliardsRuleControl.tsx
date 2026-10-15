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
  onProposeStalemate,
}: {
  state: BilliardsState;
  enabled: boolean;
  open: boolean;
  pushOut: boolean;
  onOpenChange(open: boolean): void;
  onReposition(): void;
  onProposeStalemate(): void;
}) {
  const actions =
    state.variant === "snooker" ? snookerRuleActions(state) : null;
  if (state.variant !== "nine-ball" && !actions?.reposition && !actions?.claim)
    return null;
  const directReposition = !!actions?.reposition && !actions.claim;
  const directStalemate =
    state.variant === "nine-ball" &&
    !state.decision &&
    !state.pushOutAvailable &&
    (!state.placementRegion || state.ballInHand);
  const direct = directReposition || directStalemate;
  return (
    <Button
      size="sm"
      density="adaptive"
      variant="outline"
      className="billiards-rule-trigger"
      aria-haspopup={direct ? undefined : "dialog"}
      aria-expanded={direct ? undefined : open}
      disabled={!enabled}
      onClick={() => {
        if (directReposition) onReposition();
        else if (directStalemate) onProposeStalemate();
        else onOpenChange(!open);
      }}
    >
      {directReposition ? (
        <Trans>调整母球</Trans>
      ) : directStalemate ? (
        <span className="truncate">
          <Trans comment="台球对局请求双方同意重新摆球">提议重摆</Trans>
        </span>
      ) : pushOut ? (
        <Trans>本杆推杆</Trans>
      ) : (
        <Trans>操作</Trans>
      )}
    </Button>
  );
}
