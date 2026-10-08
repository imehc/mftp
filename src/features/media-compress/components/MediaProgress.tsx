import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { MediaCancelButton } from "../MediaProcessingGuard";

export default function MediaProgress({
  fileName,
  progress,
  label,
  onCancel,
}: {
  fileName: string;
  progress?: number;
  label?: ReactNode;
  onCancel: () => void;
}) {
  const percent =
    progress == null ? null : Math.round(Math.min(100, Math.max(0, progress)));
  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <LoaderCircle className="size-4 animate-spin" />
        <Trans>正在处理</Trans>
      </h2>
      <p className="text-sm font-medium break-all">{fileName}</p>
      <div className="text-muted-foreground flex justify-between gap-3 text-xs">
        <span>{label ?? <Trans>处理中</Trans>}</span>
        {percent != null ? <span>{percent}%</span> : null}
      </div>
      {percent != null ? (
        <div
          role="progressbar"
          aria-label={fileName}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-muted h-2 overflow-hidden rounded-full"
        >
          <div className="bg-primary h-full" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        <Trans>处理期间请保持应用打开。取消后将停止当前处理。</Trans>
      </p>
      <div className="flex justify-end max-md:[&>button]:w-full">
        <MediaCancelButton onConfirm={onCancel} />
      </div>
    </section>
  );
}
