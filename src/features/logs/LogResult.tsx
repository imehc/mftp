import { cn } from "cn";
import { Check, CircleX, Minus } from "lucide-react";

import type { ActivityLog } from "~/types";

export function LogResult({
  log,
  labels,
}: {
  log: ActivityLog;
  labels: Record<string, string>;
}) {
  const Icon =
    log.result === "failed"
      ? CircleX
      : log.result === "success"
        ? Check
        : Minus;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        log.result === "failed" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {labels[log.result] ?? log.result}
    </span>
  );
}
