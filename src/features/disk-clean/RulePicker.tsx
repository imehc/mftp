import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import type { CleanRule, RuleTier } from "~/types";
import { ruleMeta } from "./rulesMeta";
import { useDiskCleanStore } from "./store";

const tierLabel: Record<RuleTier, ReactNode> = {
  safe: <Trans>安全</Trans>,
  caution: <Trans>谨慎</Trans>,
  manual: <Trans>手动</Trans>,
};

const tierOrder: readonly RuleTier[] = ["safe", "caution", "manual"];

function RuleRow({ rule, disabled }: { rule: CleanRule; disabled: boolean }) {
  const checked = useDiskCleanStore((s) => s.selectedRules.has(rule.id));
  const toggleRule = useDiskCleanStore((s) => s.toggleRule);
  const meta = ruleMeta[rule.id];

  return (
    <label
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
        disabled ? "opacity-60" : "hover:bg-muted/50"
      }`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => toggleRule(rule.id)}
      />
      <span className="min-w-0 flex-1 truncate">{meta?.label ?? rule.id}</span>
      {meta?.hint ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {meta.hint}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Rule catalog grouped by tier. `manual` rules are scannable but never
 * deletable, so they are shown for their size with the vendor's own UI named
 * in the hint.
 */
export function RulePicker({ scanning }: { scanning: boolean }) {
  const rules = useDiskCleanStore((s) => s.rules);

  return (
    <div className="flex flex-col gap-3">
      {tierOrder.map((tier) => {
        const group = rules.filter((rule) => rule.tier === tier);
        if (group.length === 0) return null;
        return (
          <section key={tier} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2">
              <Badge variant={tier === "safe" ? "outline" : "secondary"}>
                {tierLabel[tier]}
              </Badge>
              {tier === "manual" ? (
                <span className="text-xs text-muted-foreground">
                  <Trans>只统计，不删除</Trans>
                </span>
              ) : null}
            </div>
            {group.map((rule) => (
              <RuleRow key={rule.id} rule={rule} disabled={scanning} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
