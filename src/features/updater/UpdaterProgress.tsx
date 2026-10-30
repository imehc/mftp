import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";

import { Progress } from "~/components/ui/progress";
import { Spinner } from "~/components/ui/spinner";
import { formatBytes } from "~/lib/format";
import { useUpdaterStore } from "~/store/updater";

import { useUpdaterLabel } from "./use-updater-label";

export function updaterPercent(downloaded: number, total?: number) {
  return total && total > 0
    ? Math.min(100, Math.round((downloaded / total) * 100))
    : null;
}

/**
 * 进行中的更新状态，两种落点：
 * - footer：有发布说明可看时与操作按钮同排，进度条压在操作栏上边缘，
 *   列表滚动不会把进度带走，也不会把操作栏撑高一层。
 * - body：还没有任何可看内容（检查阶段）时独占正文一行，避免弹窗只剩空正文。
 */
export default function UpdaterProgress({
  variant = "footer",
}: {
  variant?: "body" | "footer";
}) {
  const { t } = useLingui();
  const label = useUpdaterLabel();
  const status = useUpdaterStore((state) => state.status);
  const phase = useUpdaterStore((state) => state.phase);
  const slow = useUpdaterStore((state) => state.connectionSlow);
  const downloaded = useUpdaterStore((state) => state.downloaded);
  const total = useUpdaterStore((state) => state.total);
  const percent = updaterPercent(downloaded, total);
  if (!["checking", "downloading", "restarting"].includes(status)) return null;
  const transferring = status === "downloading" && phase === "downloading";
  const inline = variant === "footer";
  const downloadedSize = formatBytes(downloaded);
  return (
    <>
      <div
        className={cn(
          "min-w-0",
          inline
            ? "flex flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            : "flex flex-col gap-2 text-sm",
        )}
        role="status"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Spinner
            aria-hidden
            className={cn(
              "shrink-0 motion-reduce:animate-none",
              inline && "size-3.5",
            )}
          />
          <span
            className={cn("truncate", inline && "text-foreground font-medium")}
          >
            {label}
          </span>
        </span>
        {transferring ? (
          <span
            className={cn(
              "text-muted-foreground tabular-nums",
              !inline && "text-xs",
            )}
          >
            <Trans comment="更新包已经下载的容量，downloadedSize 是格式化后的字节数">
              已下载 {downloadedSize}
            </Trans>
            {total ? ` / ${formatBytes(total)}` : null}
          </span>
        ) : null}
      </div>
      {percent !== null ? (
        <Progress
          value={percent}
          aria-label={t`下载进度`}
          className={cn(
            inline && "absolute inset-x-0 top-0 h-0.5 rounded-none",
          )}
        />
      ) : null}
      {status === "downloading" && phase === "connecting" && slow ? (
        <p className="app-description">
          <Trans comment="更新源响应慢，仍在等待">
            连接较慢，仍在等待响应。
          </Trans>
        </p>
      ) : null}
    </>
  );
}
