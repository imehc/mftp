import { useLingui } from "@lingui/react/macro";
import { ChevronRight, Download, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { Spinner } from "~/components/ui/spinner";
import { formatBytes } from "~/lib/format";
import { isDesktopPlatform } from "~/lib/platform";
import { useUpdaterStore } from "~/store/updater";

import { dismissUpdaterBanner, openUpdaterDialog } from "./controller";
import { updaterPercent } from "./UpdaterProgress";
import { useUpdaterLabel } from "./use-updater-label";

export default function UpdaterStatusBar() {
  const { t } = useLingui();
  const label = useUpdaterLabel();
  const status = useUpdaterStore((state) => state.status);
  const phase = useUpdaterStore((state) => state.phase);
  const version = useUpdaterStore((state) => state.version);
  const downloaded = useUpdaterStore((state) => state.downloaded);
  const total = useUpdaterStore((state) => state.total);
  const failed = useUpdaterStore((state) => state.error !== null);
  const dismissed = useUpdaterStore((state) => state.bannerDismissed);
  if (
    !isDesktopPlatform() ||
    dismissed ||
    status === "idle" ||
    status === "current"
  )
    return null;
  const busy = ["checking", "downloading", "restarting"].includes(status);
  const transferring = status === "downloading" && phase === "downloading";
  const percent = transferring ? updaterPercent(downloaded, total) : null;
  return (
    <div
      className="ui-density-adaptive app-bottom-bar border-border bg-muted/30 shrink-0 border-t"
      role="region"
      aria-label={t`更新状态`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Button
          data-updater-trigger
          variant="ghost"
          size="sm"
          density="adaptive"
          className="min-w-0 flex-1 justify-start"
          onClick={openUpdaterDialog}
        >
          {busy ? (
            <Spinner
              aria-hidden
              data-icon="inline-start"
              className="motion-reduce:animate-none"
            />
          ) : (
            <Download data-icon="inline-start" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {status === "ready" && !failed
              ? t({
                  message: "等待重启",
                  comment: "更新包已准备好，等待用户确认安装并重启",
                })
              : label}
          </span>
          {version ? (
            <span className="text-muted-foreground hidden shrink-0 md:inline">
              {version}
            </span>
          ) : null}
          {transferring ? (
            <span className="shrink-0 tabular-nums">
              {percent !== null ? `${percent}%` : formatBytes(downloaded)}
            </span>
          ) : null}
          <ChevronRight data-icon="inline-end" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={dismissUpdaterBanner}
          aria-label={t({
            message: "关闭更新提示",
            comment: "隐藏底部更新状态行，不取消更新任务",
          })}
        >
          <X />
        </Button>
      </div>
      {percent !== null ? (
        <Progress value={percent} aria-label={t`下载进度`} />
      ) : null}
    </div>
  );
}
