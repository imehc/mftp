import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutContent,
  DialogLayoutHeader,
  DialogLayoutBody,
} from "~/components/ui/dialog-layout";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "~/components/ui/alert-dialog";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { formatBytes } from "~/lib/format";
import { describeError } from "~/lib/errors";
import { DATA_MODULES, type AboutController } from "./use-about";

export default function DataManagementDialogs({
  controller: c,
}: {
  controller: AboutController;
}) {
  const { t } = useLingui();
  const title = c.target && c.target !== "all" ? c.moduleTitles[c.target] : "";
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
              <Trans>按模块清理</Trans>
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
              {DATA_MODULES.map((module) => ({
                module,
                label: c.moduleTitles[module],
              })).map(({ module, label }) => (
                <div
                  key={module}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {c.moduleTitles[module]}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {c.moduleBytes ? formatBytes(c.moduleBytes[module]) : "—"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    density="adaptive"
                    disabled={
                      c.busy ||
                      c.loading ||
                      !!c.error ||
                      !c.moduleBytes?.[module]
                    }
                    onClick={() => c.selectTarget(module)}
                    aria-label={t({
                      comment: "数据清理列表按钮，label 是模块名",
                      message: `清理${label}`,
                    })}
                  >
                    <Trans>清理</Trans>
                  </Button>
                </div>
              ))}
            </div>
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
              {c.resetWarnings ? (
                <Trans>应用数据已清空</Trans>
              ) : c.target === "all" ? (
                <Trans>清空所有数据？</Trans>
              ) : (
                t({
                  comment: "不可撤销的模块数据清理确认标题，title 是模块名",
                  message: `清理${title}？`,
                })
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {c.resetWarnings ? (
                <Trans>部分系统设置未能更新，请重新打开应用后检查。</Trans>
              ) : c.target === "all" ? (
                <Trans>
                  将删除所有应用内数据、缓存、日志和设置，并恢复首次打开状态。下载目录和共享目录中的文件会保留。
                </Trans>
              ) : (
                <Trans>
                  将删除此设备上该模块的全部记录，此操作无法撤销。其他模块数据、下载文件和共享目录中的文件会保留。
                </Trans>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!c.resetWarnings && c.target && c.target !== "all" ? (
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
          {!c.resetWarnings ? (
            <p className="text-muted-foreground text-xs">
              <Trans>如果相关任务仍在运行，请先完成任务后再清理。</Trans>
            </p>
          ) : null}
          {c.writeError ? (
            <Alert variant="destructive">
              <AlertDescription>{describeError(c.writeError)}</AlertDescription>
            </Alert>
          ) : null}
          {c.resetWarnings?.map((error, i) => (
            <Alert key={i} variant="destructive">
              <AlertDescription>{describeError(error)}</AlertDescription>
            </Alert>
          ))}
          <AlertDialogFooter>
            {c.resetWarnings ? (
              <Button onClick={() => window.location.assign("/")}>
                <Trans>重新打开应用</Trans>
              </Button>
            ) : (
              <>
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
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
