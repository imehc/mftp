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
} from "lucide-react";
import { toast } from "sonner";
import type {
  AppError,
  BtFileEntry,
  BtFileListing,
  BtTaskInfo,
} from "~/bindings";
import * as ipc from "~/lib/ipc";
import { describeError, toIpcError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { previewKind } from "~/lib/preview-kind";
import { Button } from "~/components/ui/button";
import PreviewSurface from "~/features/preview/PreviewSurface";

export default function FileBrowserPanel({
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
  const [error, setError] = useState<AppError | null>(null);
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
        if (!cancelled) setError(toIpcError(cause).payload);
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
      toast.error(t`无法使用系统应用打开`, {
        description: describeError(cause),
      });
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {current?.path ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              disabled={loading}
              title={t`返回上级目录`}
              aria-label={t`返回上级目录`}
              onClick={() =>
                (current?.path ?? path) ? navigate(parent) : onClose()
              }
            >
              <ArrowLeft />
            </Button>
          </>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">
            {current?.path ? current.name : t`下载文件`}
          </h2>
          {current?.path ? (
            <p className="text-muted-foreground truncate text-xs">
              {current.path}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          density="adaptive"
          title={t`下载根目录`}
          aria-label={t`下载根目录`}
          onClick={() => navigate("")}
        >
          <Home />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          density="adaptive"
          disabled={loading}
          title={t`刷新`}
          aria-label={t`刷新`}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RotateCcw />
        </Button>
      </div>

      {current && !current.isDir ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {formatBytes(current.size)}
          </span>
          <Button
            variant="outline"
            density="adaptive"
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
          <p role="alert" className="text-destructive text-center">
            {describeError(error)}
          </p>
          <Button
            variant="outline"
            density="adaptive"
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
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="hover:bg-accent absolute top-0 left-0 flex min-h-[max(44px,2.75rem)] w-full items-center gap-2 px-2"
                    style={{
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <button
                      type="button"
                      className="focus-visible:ring-ring flex min-h-[max(44px,2.75rem)] min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
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
                        density="adaptive"
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
    </div>
  );
}
