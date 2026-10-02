import { Badge } from "~/components/ui/badge";
import type { ActivityLog } from "~/types";
export function LogResult({
  log,
  labels,
}: {
  log: ActivityLog;
  labels: Record<string, string>;
}) {
  return (
    <Badge
      variant={
        log.result === "failed"
          ? "destructive"
          : log.result === "success"
            ? "secondary"
            : "outline"
      }
    >
      {labels[log.result] ?? log.result}
    </Badge>
  );
}
