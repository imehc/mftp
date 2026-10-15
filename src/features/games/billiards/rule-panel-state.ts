import type { MatchSnapshot } from "../engine/match";
import type { BilliardsState } from "./types";

export type BilliardsPanel = "rules" | "target" | "details" | "concede" | null;

export interface RulePanelState {
  scope: string;
  prompted: string | null;
  panel: BilliardsPanel;
}

export function rulePromptKey(
  state: BilliardsState,
  moveCount: number,
  enabled: boolean,
): string | null {
  if (!enabled || state.finished) return null;
  const turn = `${state.variant}:${state.shotCount}:${state.turnSeat}`;
  if (
    (state.variant === "snooker" || state.variant === "nine-ball") &&
    state.decision
  )
    return `${turn}:decision:${moveCount}`;
  if (
    state.variant === "snooker" &&
    state.on.kind === "color" &&
    state.on.nominated === null
  )
    return `${turn}:nominate`;
  return null;
}

export function reconcileRulePanel(
  previous: RulePanelState,
  scope: string,
  prompt: string | null,
): RulePanelState {
  if (previous.panel === "details")
    return scope === previous.scope ? previous : { ...previous, scope };
  const newPrompt = prompt !== null && prompt !== previous.prompted;
  if (scope === previous.scope && !newPrompt) return previous;
  return {
    scope,
    prompted: prompt ?? previous.prompted,
    panel: newPrompt
      ? prompt.endsWith(":nominate")
        ? "target"
        : "rules"
      : null,
  };
}

export function canSubmitRuleMove(
  expected: MatchSnapshot<BilliardsState>,
  current: MatchSnapshot<BilliardsState>,
  local: boolean,
): boolean {
  return (
    local &&
    !current.state.finished &&
    current.phase === "awaiting-move" &&
    current.activeSeat !== null &&
    current.activeSeat === expected.activeSeat &&
    current.moveCount === expected.moveCount &&
    current.state === expected.state
  );
}
