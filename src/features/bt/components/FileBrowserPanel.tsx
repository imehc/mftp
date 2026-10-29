import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ExternalLink,
  File,
  Folder,
  Home,
  RefreshCw,
} from "lucide-react";
import { useRef } from "react";

import type { BtTaskInfo } from "~/bindings";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import PreviewSurface from "~/features/preview/PreviewSurface";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { previewKind } from "~/lib/preview-kind";
import { useVirtualizerFontSize } from "~/lib/root-font-size";

import { useBtFileBrowser } from "../use-file-browser";

export default function FileBrowserPanel({ task }: { task: BtTaskInfo }) {
  const { t } = useLingui();
  const browser = useBtFileBrowser(task.infoHash);
  const {
    current,
    entries,
    url,
    error,
    loading,
    opening,
    openExternal,
    reload,
    parent,
  } = browser;
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  useVirtualizerFontSize(virtualizer);

  const navigate = (next: string) => {
    browser.navigate(next);
    scroller.current?.scrollTo(0, 0);
  };

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
              onClick={() => navigate(parent)}
            >
              <ArrowUp />
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
          onClick={reload}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
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

      {loading && !current ? (
        <div
          className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm"
          role="status"
        >
          <Spinner aria-label={t`加载中`} />
          <Trans>加载中…</Trans>
        </div>
      ) : error && !current ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
          <p
            role="alert"
            className="text-destructive text-center wrap-anywhere"
          >
            {describeError(error, t)}
          </p>
          <Button variant="outline" density="adaptive" onClick={reload}>
            <RefreshCw />
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : (
        <>
          {error ? (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 wrap-anywhere">
                {describeError(error, t)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={t`重试`}
                onClick={reload}
              >
                <RefreshCw />
              </Button>
            </div>
          ) : null}
          {current?.isDir ? (
            <div
              ref={scroller}
              aria-busy={loading}
              className={`border-border min-h-0 flex-1 overflow-auto rounded-lg border ${loading ? "opacity-60" : ""}`}
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
              <Trans comment="无法内联预览的文件格式">该格式不支持预览</Trans>
            </div>
          )}
        </>
      )}
      {task.status !== "Completed" ? (
        <p className="app-description">
          <Trans comment="资源未下载完时预览可能因缺失分片中断">
            未下载完成，预览可能中断。
          </Trans>
        </p>
      ) : null}
    </div>
  );
}
