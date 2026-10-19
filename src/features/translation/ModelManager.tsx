import { Trans, useLingui } from "@lingui/react/macro";
import {
  Download,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { TranslationModel } from "~/bindings";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Progress } from "~/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";

import { isModelManagementError } from "./error-scope";
import type { useTranslation } from "./use-translation";

export function ModelManager({
  controller,
  open,
  onOpenChange,
}: {
  controller: ReturnType<typeof useTranslation>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const [removing, setRemoving] = useState<TranslationModel | null>(null);
  const [lastDownloadId, setLastDownloadId] = useState<string | null>(null);
  const { snapshot, busy, error } = controller;
  const modelName = removing?.name ?? "";
  const downloadError = error != null && isModelManagementError(error);

  function startDownload(modelId: string) {
    setLastDownloadId(modelId);
    void controller.download(modelId);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            density="adaptive"
            aria-label={t`管理模型`}
            title={t`管理模型`}
            className="shrink-0"
          >
            <Settings2 />
            <span className="hidden sm:inline">
              <Trans>管理模型</Trans>
            </span>
          </Button>
        </DialogTrigger>
        <DialogLayoutContent
          placement="responsive-sheet"
          className="sm:max-w-xl"
        >
          <DialogLayoutHeader>
            <DialogTitle>
              <Trans>离线翻译模型</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>先下载所选模型，安装后即可在本机离线翻译。</Trans>
            </DialogDescription>
          </DialogLayoutHeader>
          <DialogLayoutBody className="flex flex-col gap-3">
            <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
              <span className="text-sm font-medium">
                <Trans>当前模型</Trans>
              </span>
              <Select
                value={snapshot?.selectedId ?? ""}
                disabled={!snapshot || busy}
                onValueChange={(id) => void controller.select(id)}
              >
                <SelectTrigger
                  density="adaptive"
                  className="max-w-full min-w-44"
                  aria-label={t`当前模型`}
                >
                  <SelectValue placeholder={t`选择翻译模型`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {snapshot?.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {error != null && !snapshot && (
              <Alert variant="destructive">
                <div className="flex items-start justify-between gap-3">
                  <AlertDescription>{describeError(error, t)}</AlertDescription>
                  {!busy && (
                    <Button
                      variant="outline"
                      size="sm"
                      density="adaptive"
                      className="shrink-0"
                      onClick={() => void controller.refresh(true)}
                    >
                      <RefreshCw />
                      <Trans>重试</Trans>
                    </Button>
                  )}
                </div>
              </Alert>
            )}
            {error != null && snapshot && !downloadError && (
              <Alert variant="destructive">
                <AlertDescription>{describeError(error, t)}</AlertDescription>
              </Alert>
            )}
            {snapshot?.models.map((model) => {
              const task =
                snapshot.task?.modelId === model.id ? snapshot.task : null;
              const size = formatBytes(model.bytes);
              const downloading = task?.phase === "downloading";
              const progressBytes = downloading
                ? task.completedBytes
                : model.downloadedBytes;
              const downloadPercent = Math.min(
                100,
                Math.floor((progressBytes / model.bytes) * 100),
              );
              const hasPartialDownload = !model.installed && progressBytes > 0;
              const failed = downloadError && lastDownloadId === model.id;
              return (
                <section
                  key={model.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-xl border p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <h3
                      className="min-w-0 truncate text-sm font-medium"
                      title={model.name}
                    >
                      {model.name}
                    </h3>
                  </div>
                  <div className="row-span-2 flex items-center justify-end">
                    {!model.installed && (
                      <Button
                        size="sm"
                        density="adaptive"
                        disabled={(busy && !downloading) || controller.stopping}
                        onClick={() =>
                          downloading
                            ? void controller.stop()
                            : startDownload(model.id)
                        }
                      >
                        {downloading ? (
                          <Pause />
                        ) : failed ? (
                          <RefreshCw />
                        ) : model.downloadedBytes > 0 ? (
                          <Play />
                        ) : (
                          <Download />
                        )}
                        {downloading ? (
                          <Trans>暂停</Trans>
                        ) : failed ? (
                          <Trans>重试</Trans>
                        ) : model.downloadedBytes > 0 ? (
                          <Trans>继续</Trans>
                        ) : (
                          <Trans>下载</Trans>
                        )}
                      </Button>
                    )}
                    {model.installed && (
                      <Button
                        variant="outline"
                        size="sm"
                        density="adaptive"
                        disabled={busy}
                        onClick={() => setRemoving(model)}
                      >
                        <Trash2 />
                        <Trans>移除</Trans>
                      </Button>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-muted-foreground min-w-0 truncate text-xs">
                      {size} · {model.license}
                    </p>
                    {model.recommended && (
                      <Badge variant="secondary" className="shrink-0">
                        <Trans>推荐</Trans>
                      </Badge>
                    )}
                    {model.installed && (
                      <Badge variant="outline" className="shrink-0">
                        <Trans>已安装</Trans>
                      </Badge>
                    )}
                  </div>
                  {error != null &&
                    downloadError &&
                    lastDownloadId === model.id && (
                      <p
                        className="text-destructive col-span-full text-xs"
                        role="alert"
                      >
                        {describeError(error, t)}
                      </p>
                    )}
                  {(downloading || hasPartialDownload) && (
                    <div className="col-span-full flex flex-col gap-1.5">
                      <div className="text-muted-foreground flex justify-between gap-3 text-xs tabular-nums">
                        <span>
                          {formatBytes(progressBytes)} / {size}
                        </span>
                        <span>{downloadPercent}%</span>
                      </div>
                      <Progress
                        value={downloadPercent}
                        aria-label={t`模型下载进度`}
                      />
                    </div>
                  )}
                </section>
              );
            })}
            {busy && snapshot?.task?.phase !== "downloading" && (
              <Button
                variant="outline"
                disabled={controller.stopping}
                onClick={() => void controller.stop()}
              >
                {controller.stopping ? (
                  <Trans>正在停止…</Trans>
                ) : (
                  <Trans>停止当前任务</Trans>
                )}
              </Button>
            )}
          </DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
      <AlertDialog
        open={removing != null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>移除模型</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>移除「{modelName}」模型，之后可重新下载。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) void controller.remove(removing.id);
                setRemoving(null);
              }}
            >
              <Trans>移除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
