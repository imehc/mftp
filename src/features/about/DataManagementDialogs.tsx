import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import type { AppDataModule } from "~/types";

import type { AboutController } from "./use-about";

/** 文件类模块没有记录数，确认文案要说清代价与保留范围。 */
function targetDescription(
  target: AppDataModule | "all",
  fileDescriptions: Partial<Record<AppDataModule, string>>,
) {
  if (target === "all")
    return (
      <Trans>
        将删除所有应用内数据、缓存、日志和设置，并恢复首次打开状态。下载目录和共享目录中的文件会保留。
      </Trans>
    );
  const file = fileDescriptions[target];
  if (file) return file;
  return (
    <Trans>
      将删除此设备上该模块的全部记录，此操作无法撤销。其他模块数据、下载文件和共享目录中的文件会保留。
    </Trans>
  );
}

export default function DataManagementDialogs({
  controller: c,
}: {
  controller: AboutController;
}) {
  const { t } = useLingui();
  const title = c.target && c.target !== "all" ? c.moduleTitles[c.target] : "";
  const fileDescriptions = {
    translationModels: t`将删除已下载的翻译模型，之后需要重新下载。`,
    downloads: t`将清理下载任务的引擎数据与缓存，下载目录中的文件会保留。`,
    cache: t`将删除诗词同步产生的临时文件，不影响已导入的诗词数据。`,
  };
  const description: ReactNode = c.target
    ? targetDescription(c.target, fileDescriptions)
    : null;
  return (
    <>
      <Dialog
        open={c.modulesOpen}
        onOpenChange={(open) => {
          if (!c.busy) c.setModulesOpen(open);
        }}
      >
        <DialogLayoutContent
          className="ui-density-adaptive"
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>存储明细</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            {c.error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {describeError(c.error)}
                  <Button
                    variant="outline"
                    density="adaptive"
                    disabled={c.loading || c.busy}
                    onClick={() => void c.reload()}
                  >
                    <Trans>重试</Trans>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="divide-y">
              {c.storageRows.map(({ key, label, bytes, module }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {bytes === null ? "—" : formatBytes(bytes)}
                    </p>
                  </div>
                  {module ? (
                    <Button
                      variant="outline"
                      size="sm"
                      density="adaptive"
                      disabled={c.busy || c.loading || !!c.error || !bytes}
                      onClick={() => c.selectTarget(module ?? null)}
                      aria-label={t({
                        message: `清理${label}`,
                        comment: "存储明细行的清理按钮，label 是分类名",
                      })}
                    >
                      <Trans>清理</Trans>
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              <Trans>
                主数据库和密钥文件包含正在使用的记录，请在对应模块内清理。
              </Trans>
            </p>
          </DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
      <AlertDialog
        open={!!c.target}
        onOpenChange={(open) => {
          if (!open) c.selectTarget(null);
        }}
      >
        <AlertDialogContent className="ui-density-adaptive md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {c.target === "all" ? t`清空所有数据？` : t`清理${title}？`}
            </AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {c.target && c.target !== "all" ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>
                <Trans>清理范围</Trans>
              </span>
              <span>
                {title} ·{" "}
                {c.moduleBytes ? formatBytes(c.moduleBytes[c.target]) : "—"}
              </span>
            </div>
          ) : null}
          <p className="text-muted-foreground text-xs">
            <Trans>如果相关任务仍在运行，请先完成任务后再清理。</Trans>
          </p>
          {c.writeError ? (
            <Alert variant="destructive">
              <AlertDescription>{describeError(c.writeError)}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={c.busy}>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={c.busy}
              onClick={(e) => {
                e.preventDefault();
                void c.confirm();
              }}
            >
              {c.busy ? <Trans>正在清理…</Trans> : <Trans>确认清理</Trans>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
