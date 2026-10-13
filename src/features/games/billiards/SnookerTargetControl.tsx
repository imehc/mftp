import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDownIcon, CircleDotIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";

import { ballDefinition } from "./ball-definitions";
import { snookerSelection } from "./snooker-selection";
import { SnookerBall } from "./SnookerBall";
import type { BilliardsMove, SnookerState } from "./types";

export function SnookerTargetControl({
  state,
  enabled,
  open,
  kind,
  onKind,
  onOpenChange,
  onMove,
}: {
  state: SnookerState;
  enabled: boolean;
  open: boolean;
  kind: "color" | "free";
  onKind(kind: "color" | "free"): void;
  onOpenChange(open: boolean): void;
  onMove(move: BilliardsMove): boolean;
}) {
  const { t } = useLingui();
  const selection = snookerSelection(state);
  const targetId =
    state.on.kind === "red"
      ? 8
      : state.on.kind === "clearance"
        ? state.on.color
        : state.on.nominated;
  const trigger = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(open);
  useEffect(() => {
    if (previousOpen.current && !open) {
      if (trigger.current && !trigger.current.disabled) trigger.current.focus();
      else
        document
          .querySelector<HTMLButtonElement>(".billiards-game [data-game-more]")
          ?.focus();
    }
    previousOpen.current = open;
  }, [open]);

  const toggle = (next: "color" | "free") => {
    onKind(next);
    onOpenChange(!(open && kind === next));
  };

  return (
    <div className="billiards-target flex min-w-0 items-center gap-1">
      <Button
        ref={trigger}
        size="sm"
        density="adaptive"
        variant={selection.colors.length ? "outline" : "ghost"}
        disabled={
          !enabled ||
          !selection.editable ||
          !selection.colors.length ||
          (open && kind !== "color")
        }
        className="disabled:text-muted-foreground disabled:opacity-100"
        aria-label={t`选择目标球`}
        aria-expanded={open && kind === "color"}
        onClick={() => toggle("color")}
      >
        {targetId === null ? (
          <Trans comment="斯诺克出杆前选择目标彩球">选彩</Trans>
        ) : (
          <SnookerBall id={targetId} />
        )}
        {selection.colors.length ? (
          <ChevronDownIcon data-icon="inline-end" />
        ) : null}
      </Button>
      {state.freeBall ? (
        <Button
          size="icon-sm"
          density="adaptive"
          variant="ghost"
          disabled={
            !enabled ||
            !selection.editable ||
            (state.on.kind === "color" && state.on.nominated === null) ||
            (open && kind !== "free")
          }
          className="disabled:opacity-100"
          aria-label={t({
            message: "自由球",
            comment: "斯诺克可选的替代目标球提名",
          })}
          title={t({
            message: "自由球",
            comment: "斯诺克可选的替代目标球提名",
          })}
          aria-expanded={open && kind === "free"}
          onClick={() => toggle("free")}
        >
          {state.nominatedFree === null ? (
            <CircleDotIcon />
          ) : (
            <span
              aria-hidden="true"
              className="size-4 rounded-full ring-1 ring-black/25"
              style={{
                backgroundColor: ballDefinition(state.nominatedFree, "snooker")
                  .color,
              }}
            />
          )}
        </Button>
      ) : null}
      {state.freeBall && state.nominatedFree !== null ? (
        <Button
          size="icon-sm"
          density="adaptive"
          variant="ghost"
          disabled={!enabled || open}
          aria-label={t({
            message: "不使用",
            comment: "斯诺克放弃自由球提名，直接打原目标",
          })}
          onClick={() => onMove({ type: "nominate-free", ballId: null })}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
