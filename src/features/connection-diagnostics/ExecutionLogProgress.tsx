import { Trans, useLingui } from "@lingui/react/macro";

import type { DiagnosticProgress } from "~/bindings";
import { transferPhaseLabel } from "~/features/transfers/phase-label";

export default function ExecutionLogProgress({
  progress,
}: {
  progress: DiagnosticProgress;
}) {
  const { t, i18n } = useLingui();
  const completed = i18n.number(progress.completed);
  const total = progress.total === null ? null : i18n.number(progress.total);
  return (
    <p className="text-muted-foreground text-xs tabular-nums">
      {transferPhaseLabel(progress.phase, t)} ·{" "}
      {total === null ? (
        <Trans comment="执行日志最近报告的进度计数，总量未知">
          已处理 {completed}
        </Trans>
      ) : (
        <Trans comment="执行日志最近报告的进度计数及总量">
          进度 {completed} / {total}
        </Trans>
      )}
    </p>
  );
}
