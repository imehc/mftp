import { useState } from "react";

import {
  type BilliardsPanel,
  reconcileRulePanel,
  type RulePanelState,
  rulePromptKey,
} from "./rule-panel-state";
import type { BilliardsState } from "./types";

export function useRulePanel(
  state: BilliardsState,
  moveCount: number,
  phase: string,
  activeSeat: number | null,
  enabled: boolean,
) {
  const scope = `${moveCount}:${phase}:${activeSeat}:${state.finished}`;
  const prompt = rulePromptKey(state, moveCount, enabled);
  const [stored, setStored] = useState<RulePanelState>({
    scope: "",
    prompted: null,
    panel: null,
  });
  const current = reconcileRulePanel(stored, scope, prompt);
  if (current !== stored) setStored(current);
  return {
    panel: current.panel,
    setPanel: (panel: BilliardsPanel) => setStored({ ...current, panel }),
  };
}
