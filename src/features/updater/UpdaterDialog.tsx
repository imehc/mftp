import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { CircleCheck, Download } from "lucide-react";
import { useRef } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  checkForUpdateManually,
  closeUpdaterDialog,
  restartToApplyUpdate,
  startUpdateDownload,
} from "~/features/updater/controller";
import { describeError } from "~/lib/errors";
import { isAndroidPlatform, isUpdaterPlatform } from "~/lib/platform";
import { useUpdaterStore } from "~/store/updater";

import UpdaterProgress from "./UpdaterProgress";
import UpdaterReleaseNotes from "./UpdaterReleaseNotes";
import { useUpdaterLabel, useUpdaterSummary } from "./use-updater-label";

export default function UpdaterDialog() {
  const { t } = useLingui();
  const summary = useUpdaterSummary();
  const label = useUpdaterLabel();
  const open = useUpdaterStore((state) => state.dialogOpen);
  const status = useUpdaterStore((state) => state.status);
  const version = useUpdaterStore((state) => state.version);
  const notes = useUpdaterStore((state) => state.releaseNotes);
  const truncated = useUpdaterStore((state) => state.notesTruncated);
  const error = useUpdaterStore((state) => state.error);
  const installed = useUpdaterStore((state) => state.installed);
  const opener = useRef<HTMLElement | null>(null);
  if (!isUpdaterPlatform()) return null;
  const busy = ["checking", "downloading", "restarting"].includes(status);
  // Android 的安装交给系统安装器并替换应用，没有“重启并更新”这回事。
  const androidInstall = isAndroidPlatform();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) closeUpdaterDialog();
      }}
    >
      <DialogLayoutContent
        className={cn("grid-cols-[minmax(0,1fr)]", version && "md:max-w-lg")}
        showCloseButton={false}
        onOpenAutoFocus={() => {
          // WebKit 点击按钮不一定移动焦点；body 不是可恢复的触发器。
          const active = document.activeElement;
          opener.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // 用户可能在后台切过页面；旧触发器卸载时回到当前页的更新入口。
          const previous = opener.current;
          const target =
            previous?.isConnected && previous.getClientRects().length
              ? previous
              : document.querySelector<HTMLElement>("[data-updater-trigger]");
          target?.focus();
          opener.current = null;
        }}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle className="flex items-center gap-2 leading-snug">
            <Download aria-hidden className="size-4 shrink-0" />
            <Trans>更新</Trans>
          </DialogTitle>
          {summary.lead || summary.detail ? (
            <DialogDescription
              role={summary.lead ? "status" : undefined}
              className="mt-1 text-xs wrap-anywhere"
            >
              {summary.lead ? (
                <span className="text-foreground font-medium">
                  {summary.lead}
                </span>
              ) : null}
              {summary.lead && summary.detail ? " · " : null}
              {summary.detail}
            </DialogDescription>
          ) : null}
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4">
          {/* 还没有发布说明可看时（检查阶段），进度留在正文，避免弹窗只剩空正文。 */}
          {version ? null : <UpdaterProgress variant="body" />}
          {status === "current" ? (
            <p className="flex items-center gap-2 text-sm" role="status">
              <CircleCheck aria-hidden className="size-4 shrink-0" />
              {label}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="wrap-anywhere">
                {describeError(error, t)}
              </AlertDescription>
            </Alert>
          ) : null}
          {version || status === "error" ? (
            <UpdaterReleaseNotes body={notes} truncated={truncated} />
          ) : null}
        </DialogLayoutBody>
        <DialogLayoutFooter className="relative items-center">
          {version ? <UpdaterProgress /> : null}
          <div className="flex flex-row gap-2 max-md:flex-1 md:justify-end max-md:[&>button]:min-w-0 max-md:[&>button]:flex-1 max-md:[&>button]:whitespace-normal">
            <Button
              density="adaptive"
              variant="outline"
              onClick={closeUpdaterDialog}
            >
              {status === "current"
                ? t`完成`
                : status === "ready"
                  ? androidInstall
                    ? t`稍后安装`
                    : t`稍后重启`
                  : busy
                    ? t({
                        message: "收起",
                        comment: "关闭更新弹窗并继续后台任务，不取消下载",
                      })
                    : t`稍后`}
            </Button>
            {status === "available" ? (
              <Button
                density="adaptive"
                onClick={() => void startUpdateDownload()}
              >
                <Trans>下载更新</Trans>
              </Button>
            ) : null}
            {status === "ready" ? (
              <Button
                density="adaptive"
                onClick={() => void restartToApplyUpdate()}
              >
                {error
                  ? installed && !androidInstall
                    ? t`重试重启`
                    : t`重试安装`
                  : androidInstall
                    ? t`立即安装`
                    : t`重启并更新`}
              </Button>
            ) : null}
            {status === "error" ? (
              <Button
                density="adaptive"
                onClick={() => void checkForUpdateManually()}
              >
                <Trans>重新检查</Trans>
              </Button>
            ) : null}
          </div>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
