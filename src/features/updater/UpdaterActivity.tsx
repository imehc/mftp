import { useLingui } from "@lingui/react/macro";
import {
  ChevronRight,
  CircleAlert,
  Download,
  LoaderCircle,
} from "lucide-react";

import { Progress } from "~/components/ui/progress";
import { openUpdaterDialog } from "~/features/updater/controller";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { useUpdaterStore } from "~/store/updater";

import { updaterPercent } from "./UpdaterProgress";
import { useUpdaterLabel } from "./use-updater-label";

/** 活动中心的更新卡片；点击只打开现有更新弹窗，不重复检查或启动任务。 */
export default function UpdaterActivity() {
  const { t } = useLingui();
  const label = useUpdaterLabel();
  const status = useUpdaterStore((state) => state.status);
  const phase = useUpdaterStore((state) => state.phase);
  const version = useUpdaterStore((state) => state.version);
  const downloaded = useUpdaterStore((state) => state.downloaded);
  const total = useUpdaterStore((state) => state.total);
  const error = useUpdaterStore((state) => state.error);
  if (status === "idle" || status === "current") return null;
  const failed = error !== null;
  const busy =
    status === "checking" ||
    status === "downloading" ||
    status === "restarting";
  const transferring = status === "downloading" && phase === "downloading";
  const percent = transferring ? updaterPercent(downloaded, total) : null;
  const title =
    status === "ready" && !failed
      ? t({
          message: "等待重启",
          comment: "更新包已准备好，等待用户确认安装并重启",
        })
      : label;
  return (
    <section className="bg-card shrink-0 rounded-xl border">
      <button
        type="button"
        data-updater-trigger
        aria-haspopup="dialog"
        onClick={openUpdaterDialog}
        className="bg-card hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-start gap-2 rounded-xl p-3 text-left outline-none focus-visible:ring-2"
      >
        {failed ? (
          <CircleAlert
            aria-hidden
            className="text-destructive mt-0.5 size-4 shrink-0"
          />
        ) : busy ? (
          <LoaderCircle
            aria-hidden
            className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Download
            aria-hidden
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold">{title}</span>
            {version ? (
              <span className="text-muted-foreground text-xs">{version}</span>
            ) : null}
          </span>
          {error ? (
            <span className="text-destructive mt-1 block text-xs wrap-break-word">
              {describeError(error, t)}
            </span>
          ) : null}
        </span>
        {transferring ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {percent !== null ? `${percent}%` : formatBytes(downloaded)}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden
          className="text-muted-foreground mt-0.5 size-4 shrink-0"
        />
      </button>
      {percent !== null ? (
        <div className="px-3 pb-3">
          <Progress value={percent} aria-label={t`下载进度`} />
        </div>
      ) : null}
    </section>
  );
}
