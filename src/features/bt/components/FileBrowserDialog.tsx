import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  ExternalLink,
  File,
  Folder,
  Home,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { BtFileEntry, BtFileListing, BtTaskInfo } from "~/bindings";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import { previewKind } from "~/lib/preview-kind";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import PreviewSurface from "~/features/preview/PreviewSurface";

export default function FileBrowserDialog({
  task,
  onClose,
}: {
  task: BtTaskInfo;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [path, setPath] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<BtFileListing | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const entries = listing?.entries ?? [];
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 44,
    overscan: 8,
  });

  useEffect(() => {
    let cancelled = false;
    // 快速切换目录或关闭弹窗后，旧请求不能覆盖当前文件及预览地址。
    void (async () => {
      setLoading(true);
      setError(null);
      setUrl(null);
      setListing(null);
      try {
        const result = await ipc.btBrowseFiles(task.infoHash, path);
        if (cancelled) return;
        setListing(result);
        if (
          !result.current.isDir &&
          previewKind(result.current.name) !== "other"
        ) {
          const preview = await ipc.btPreviewFile(
            task.infoHash,
            result.current.path,
          );
          if (cancelled) return;
          // 每次重试重新读取原文件；服务端同时使用 no-store 禁用响应缓存。
          setUrl(`${preview.url}&attempt=${revision}`);
        }
      } catch (cause) {
        if (!cancelled) setError(String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.infoHash, path, revision]);

  const openExternal = async (entry: BtFileEntry) => {
    setOpening(true);
    try {
      await ipc.btOpenFile(task.infoHash, entry.path);
    } catch (cause) {
      toast.error(t`无法使用系统应用打开`, { description: String(cause) });
    } finally {
      setOpening(false);
    }
  };
  const current = listing?.current;
  const navigate = (next: string) => {
    setPath(next);
    scroller.current?.scrollTo(0, 0);
  };
  const parent = (current?.path ?? path ?? "")
    .split("/")
    .slice(0, -1)
    .join("/");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(46rem,calc(100dvh-2rem))] min-h-0 flex-col gap-3 overflow-hidden sm:max-w-4xl"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading || !(current?.path ?? path)}
            title={t`返回上级目录`}
            aria-label={t`返回上级目录`}
            onClick={() => navigate(parent)}
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">
              {current?.path ? current.name : task.label}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {current?.path || t`下载文件`}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t`下载根目录`}
            aria-label={t`下载根目录`}
            onClick={() => navigate("")}
          >
            <Home />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading}
            title={t`刷新`}
            aria-label={t`刷新`}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RotateCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t`关闭`}
            aria-label={t`关闭`}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        {current && !current.isDir ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground tabular-nums">
              {formatBytes(current.size)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={opening}
              onClick={() => void openExternal(current)}
            >
              <ExternalLink />
              <Trans>使用系统应用打开</Trans>
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div
            className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" />
            <Trans>加载中…</Trans>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
            <p className="text-destructive text-center">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RotateCcw />
              <Trans>重试</Trans>
            </Button>
          </div>
        ) : current?.isDir ? (
          <div
            ref={scroller}
            className="border-border min-h-0 flex-1 overflow-auto rounded-lg border"
          >
            {entries.length === 0 ? (
              <p className="text-muted-foreground p-6 text-center text-sm">
                <Trans>目录中暂无文件</Trans>
              </p>
            ) : (
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const entry = entries[item.index];
                  const entryName = entry.name;
                  return (
                    <div
                      key={entry.path}
                      className="hover:bg-accent absolute top-0 left-0 flex w-full items-center gap-2 px-2"
                      style={{
                        height: item.size,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      <button
                        type="button"
                        className="focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                        title={entry.name}
                        onClick={() => navigate(entry.path)}
                      >
                        {entry.isDir ? (
                          <Folder className="text-primary size-4 shrink-0" />
                        ) : (
                          <File className="text-muted-foreground size-4 shrink-0" />
                        )}
                        <span className="truncate">{entry.name}</span>
                        {!entry.isDir ? (
                          <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                            {formatBytes(entry.size)}
                          </span>
                        ) : null}
                      </button>
                      {!entry.isDir ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={opening}
                          title={t`使用系统应用打开`}
                          aria-label={t`使用系统应用打开 ${entryName}`}
                          onClick={() => void openExternal(entry)}
                        >
                          <ExternalLink />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : current && url ? (
          <PreviewSurface
            key={url}
            url={url}
            name={current.name}
            kind={previewKind(current.name)}
          />
        ) : (
          <div className="text-muted-foreground border-border flex flex-1 items-center justify-center rounded-lg border p-4 text-center text-sm">
            <Trans>该格式不支持预览，可使用系统应用打开</Trans>
          </div>
        )}
        {task.status !== "Completed" ? (
          <p className="text-muted-foreground text-xs">
            <Trans>
              资源尚未下载完成，缺失分片可能导致预览中断。暂停任务会保持暂停。
            </Trans>
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
