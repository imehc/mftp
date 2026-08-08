import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, FolderOpen, FolderSearch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";
import * as ipc from "~/lib/ipc";
import type { TreeNode } from "~/types";
import { SizeTreemap } from "./SizeTreemap";
import { useDiskAnalyze } from "./useDiskAnalyze";

function Breadcrumb({
  stack,
  onJump,
}: {
  stack: TreeNode[];
  onJump: (index: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs">
      {stack.map((node, index) => (
        <span key={node.path} className="flex items-center gap-0.5">
          {index > 0 ? (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
          <button
            type="button"
            className="max-w-[12rem] truncate rounded px-1 py-0.5 hover:bg-muted disabled:cursor-default disabled:opacity-100"
            disabled={index === stack.length - 1}
            onClick={() => onJump(index)}
            title={node.path}
          >
            {node.name}
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Arbitrary-directory analysis. Read-only by design: the backend's remove
 * gate only accepts paths from a rule scan's allowlist, so nothing here
 * offers a delete button.
 */
export function AnalyzePanel() {
  const { t } = useLingui();
  const { phase, stack, current, pickAndAnalyze, drill, drillTo, cancel } =
    useDiskAnalyze();

  const busy = phase === "expanding" || phase === "running";

  const reveal = async (path: string) => {
    try {
      await ipc.diskCleanReveal(path);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        {stack.length > 0 ? (
          <Breadcrumb stack={stack} onJump={drillTo} />
        ) : (
          <p className="text-xs text-muted-foreground">
            <Trans>选一个目录，按体积排行</Trans>
          </p>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {busy ? (
            <Button variant="outline" size="sm" onClick={() => void cancel()}>
              <Trans>取消</Trans>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void pickAndAnalyze()}
            >
              <FolderSearch data-icon="inline-start" />
              <Trans>选择目录</Trans>
            </Button>
          )}
        </div>
      </div>

      {busy ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <Trans>正在分析…</Trans>
        </div>
      ) : null}

      {!busy && phase === "canceled" ? (
        <p className="text-xs text-muted-foreground">
          <Trans>已取消</Trans>
        </p>
      ) : null}

      {!busy && current ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row">
          <div className="min-h-[10rem] flex-1 overflow-hidden rounded-lg border border-border bg-card p-1.5">
            <SizeTreemap node={current} onDrill={drill} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
            {current.children.length === 0 ? (
              <p className="p-2.5 text-xs text-muted-foreground">
                <Trans>这一层没有内容</Trans>
              </p>
            ) : (
              current.children.slice(0, 200).map((child) => (
                <div
                  key={child.path}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-muted/50"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left disabled:cursor-default"
                    disabled={!child.isDir}
                    onClick={() => drill(child)}
                    title={child.path}
                  >
                    {child.name}
                  </button>
                  <span className="w-20 shrink-0 text-right tabular-nums">
                    {formatBytes(child.bytes)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`在 Finder 中显示`}
                    title={t`在 Finder 中显示`}
                    onClick={() => void reveal(child.path)}
                  >
                    <FolderOpen />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
