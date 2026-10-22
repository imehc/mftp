import { Trans, useLingui } from "@lingui/react/macro";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { describeError } from "~/lib/errors";
import type { AppError, RsyncDirection, RsyncPreview } from "~/types";

const VISIBLE_ITEMS = 200;

export interface RsyncPreviewState {
  requestId: string;
  direction: RsyncDirection;
  localDir: string;
  remoteDir: string;
  displayName: string;
  deleteExtraneous: boolean;
  preview: RsyncPreview | null;
  loading: boolean;
  error: AppError | null;
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono break-all">{value}</span>
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="bg-muted text-foreground rounded px-2 py-1 tabular-nums">
      <span className="text-muted-foreground">{label}</span> {value}
    </span>
  );
}

export default function RsyncSyncDialog({
  state,
  onOpenChange,
  onRetry,
  onConfirm,
}: {
  state: RsyncPreviewState | null;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLingui();
  const preview = state?.preview ?? null;
  const changes = preview
    ? preview.added + preview.updated + preview.deleted
    : 0;
  const deletedCount = preview?.deleted ?? 0;
  const name = state?.displayName ?? "";
  const sourceLabel = state?.direction === "download" ? t`远端` : t`本机`;
  const targetLabel = state?.direction === "download" ? t`本机` : t`远端`;
  const sourcePath =
    state?.direction === "download" ? state.remoteDir : state?.localDir;
  const targetPath =
    state?.direction === "download" ? state?.localDir : state?.remoteDir;
  const visibleItems = preview ? preview.items.slice(0, VISIBLE_ITEMS) : [];
  const kindLabels = {
    added: t`新增`,
    updated: t`更新`,
    deleted: t`删除`,
  };

  return (
    <Dialog open={!!state} onOpenChange={onOpenChange}>
      <DialogLayoutContent
        placement="responsive-sheet"
        className="md:max-w-2xl"
        showCloseButton={false}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>确认同步</Trans>
          </DialogTitle>
          <DialogDescription className="truncate">
            {state?.direction === "upload" ? (
              <Trans>上传 “{name}” 到远端</Trans>
            ) : state ? (
              <Trans>从远端下载 “{name}”</Trans>
            ) : null}
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-3">
          {state ? (
            <>
              <div className="bg-muted/40 flex flex-col gap-1 rounded-md p-2 text-xs">
                <PathRow label={sourceLabel} value={sourcePath ?? ""} />
                <PathRow label={targetLabel} value={targetPath ?? ""} />
              </div>
              {state.loading ? (
                <div
                  role="status"
                  className="text-muted-foreground flex items-center gap-2 text-sm"
                >
                  <LoaderCircle className="size-4 animate-spin" />
                  <Trans>正在检测 rsync 并生成同步预览…</Trans>
                </div>
              ) : null}
              {state.error ? (
                <>
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>
                      <Trans>无法生成同步预览</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      {describeError(state.error, t)}
                    </AlertDescription>
                  </Alert>
                  <p className="text-muted-foreground text-xs">
                    <Trans>本次操作尚未执行任何写入。</Trans>
                  </p>
                </>
              ) : null}
              {preview ? (
                <>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <CountChip label={t`新增`} value={preview.added} />
                    <CountChip label={t`更新`} value={preview.updated} />
                    <CountChip label={t`删除`} value={preview.deleted} />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {state.deleteExtraneous
                      ? t`目标多余文件：删除`
                      : t`目标多余文件：保留`}
                  </p>
                  {state.deleteExtraneous && preview.deleted > 0 ? (
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertTitle>
                        <Trans>将删除目标中的多余内容</Trans>
                      </AlertTitle>
                      <AlertDescription>
                        {state.direction === "upload" ? (
                          <Trans>
                            确认后将删除远端目标中源端不存在的 {deletedCount}{" "}
                            项内容。
                          </Trans>
                        ) : (
                          <Trans>
                            确认后将删除本机目标中源端不存在的 {deletedCount}{" "}
                            项内容。
                          </Trans>
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {changes === 0 ? (
                    <div
                      role="status"
                      className="bg-muted/50 text-muted-foreground rounded-md px-2.5 py-2 text-xs"
                    >
                      <Trans comment="rsync 预览结果为空">目标已是最新</Trans>
                    </div>
                  ) : null}
                  {visibleItems.length > 0 ? (
                    <ul className="border-border divide-border divide-y rounded-md border text-xs">
                      {visibleItems.map((item, index) => (
                        <li
                          key={`${item.kind}:${index}:${item.path}`}
                          className="flex items-start gap-2 px-2 py-1.5"
                        >
                          <span
                            aria-hidden
                            className="text-muted-foreground w-3 shrink-0 text-center font-mono"
                          >
                            {item.kind === "added"
                              ? "+"
                              : item.kind === "updated"
                                ? "~"
                                : "-"}
                          </span>
                          <span className="sr-only">
                            {kindLabels[item.kind]}
                          </span>
                          <span className="min-w-0 font-mono break-all">
                            {item.path}
                            {item.isDir ? "/" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {preview.items.length > VISIBLE_ITEMS ? (
                    <p className="text-muted-foreground text-xs">
                      <Trans>仅显示前 {VISIBLE_ITEMS} 项，执行仍处理全部</Trans>
                    </p>
                  ) : null}
                  {preview.truncated ? (
                    <p className="text-muted-foreground text-xs">
                      <Trans>更改过多，预览不完整，执行仍处理全部</Trans>
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </DialogLayoutBody>
        <DialogLayoutFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <Trans>取消</Trans>
          </Button>
          {state?.error ? (
            <Button onClick={onRetry} disabled={state.loading}>
              <Trans>重新预览</Trans>
            </Button>
          ) : (
            <Button
              onClick={onConfirm}
              disabled={!preview || state?.loading === true || changes === 0}
            >
              <Trans>开始同步</Trans>
            </Button>
          )}
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
