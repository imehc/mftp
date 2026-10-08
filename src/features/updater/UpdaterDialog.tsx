import { Trans, useLingui } from "@lingui/react/macro";
import { Download } from "lucide-react";
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
import { Separator } from "~/components/ui/separator";
import { describeError } from "~/lib/errors";
import { isDesktopPlatform } from "~/lib/platform";
import { useUpdaterStore } from "~/store/updater";

import {
  checkForUpdateManually,
  closeUpdaterDialog,
  restartToApplyUpdate,
  startUpdateDownload,
} from "./controller";
import UpdaterProgress from "./UpdaterProgress";
import UpdaterReleaseNotes from "./UpdaterReleaseNotes";
import { useUpdaterLabel } from "./use-updater-label";

export default function UpdaterDialog() {
  const { t } = useLingui();
  const label = useUpdaterLabel();
  const open = useUpdaterStore((state) => state.dialogOpen);
  const status = useUpdaterStore((state) => state.status);
  const version = useUpdaterStore((state) => state.version);
  const currentVersion = useUpdaterStore((state) => state.currentVersion);
  const notes = useUpdaterStore((state) => state.releaseNotes);
  const truncated = useUpdaterStore((state) => state.notesTruncated);
  const error = useUpdaterStore((state) => state.error);
  const installed = useUpdaterStore((state) => state.installed);
  const opener = useRef<HTMLElement | null>(null);
  if (!isDesktopPlatform()) return null;
  const busy = ["checking", "downloading", "restarting"].includes(status);
  const title = status === "downloading" ? t`正在更新` : label;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) closeUpdaterDialog();
      }}
    >
      <DialogLayoutContent
        className="grid-cols-[minmax(0,1fr)] md:max-w-lg"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
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
            <Download className="size-4 shrink-0" />
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs wrap-anywhere">
            {version ? (
              <Trans comment="更新对话框版本对比，version 是可用版本，currentVersion 是正在运行的版本">
                版本 {version} · 当前 {currentVersion}
              </Trans>
            ) : (
              t`MFTP 应用更新`
            )}
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4">
          {version ? (
            <UpdaterReleaseNotes body={notes} truncated={truncated} />
          ) : status === "error" ? (
            <UpdaterReleaseNotes body="" truncated={false} />
          ) : null}
          {status === "current" ? (
            <p className="text-muted-foreground text-sm">
              <Trans>暂时没有可用更新。</Trans>
            </p>
          ) : null}
        </DialogLayoutBody>
        <div className="flex flex-col gap-4">
          {version && (busy || status === "ready" || error) ? (
            <Separator />
          ) : null}
          <UpdaterProgress />
          {status === "ready" && !error ? (
            <p className="text-sm" role="status">
              {installed
                ? t`更新已安装，重启应用后生效。`
                : t`更新包已准备好，重启时安装。请先保存正在进行的工作。`}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="max-h-32 overflow-y-auto wrap-anywhere">
                {describeError(error, t)}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogLayoutFooter className="max-md:[&>button]:h-auto max-md:[&>button]:min-h-8 max-md:[&>button]:py-1.5 max-md:[&>button]:whitespace-normal">
            <Button variant="outline" onClick={closeUpdaterDialog}>
              {status === "current"
                ? t`完成`
                : status === "ready"
                  ? t`稍后重启`
                  : busy
                    ? t({
                        message: "收起",
                        comment: "关闭更新弹窗并继续后台任务，不取消下载",
                      })
                    : t`稍后`}
            </Button>
            {status === "available" ? (
              <Button onClick={() => void startUpdateDownload()}>
                <Trans>下载更新</Trans>
              </Button>
            ) : null}
            {status === "ready" ? (
              <Button onClick={() => void restartToApplyUpdate()}>
                {error
                  ? installed
                    ? t`重试重启`
                    : t`重试安装`
                  : t`重启并更新`}
              </Button>
            ) : null}
            {status === "error" ? (
              <Button onClick={() => void checkForUpdateManually()}>
                <Trans>重新检查</Trans>
              </Button>
            ) : null}
          </DialogLayoutFooter>
        </div>
      </DialogLayoutContent>
    </Dialog>
  );
}
