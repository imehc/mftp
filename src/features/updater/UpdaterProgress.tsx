import { Trans, useLingui } from "@lingui/react/macro";

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

export default function UpdaterProgress() {
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
  const downloadedSize = formatBytes(downloaded);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2" role="status">
        <Spinner aria-hidden className="shrink-0 motion-reduce:animate-none" />
        <span>{label}</span>
      </div>
      {transferring ? (
        <>
          <div className="text-muted-foreground flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums">
            <span>
              <Trans comment="更新包已经下载的容量，downloadedSize 是格式化后的字节数">
                已下载 {downloadedSize}
              </Trans>
              {total ? ` / ${formatBytes(total)}` : null}
            </span>
            {percent !== null ? <span>{percent}%</span> : null}
          </div>
          {percent !== null ? (
            <Progress value={percent} aria-label={t`下载进度`} />
          ) : null}
        </>
      ) : null}
      {status === "downloading" && phase === "connecting" && slow ? (
        <p className="text-muted-foreground text-xs">
          <Trans comment="更新源响应慢，仍在等待">
            连接较慢，仍在等待响应。
          </Trans>
        </p>
      ) : null}
    </div>
  );
}
