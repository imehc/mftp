import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Ellipsis, RefreshCw, Trash2 } from "lucide-react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { describeError } from "~/lib/errors";

import LogDialogs from "./LogDialogs";
import LogFilters from "./LogFilters";
import LogList from "./LogList";
import { useActivityLogs } from "./use-activity-logs";

export default function ActivityLogsPage() {
  const { t } = useLingui();
  const c = useActivityLogs();
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      <ToolPageHeader
        showHome={false}
        title={<Trans>活动日志</Trans>}
        leading={
          <Button variant="ghost" size="icon-sm" density="adaptive" asChild>
            <Link to="/settings" aria-label={t`返回设置`}>
              <ArrowLeft />
            </Link>
          </Button>
        }
        trailing={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              disabled={c.loading || c.busy}
              aria-label={t`刷新`}
              onClick={() => void c.reload()}
            >
              <RefreshCw className={c.loading ? "animate-spin" : undefined} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  density="adaptive"
                  aria-label={t`更多操作`}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="ui-density-adaptive">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={c.busy}
                    onSelect={() => c.setDeleting("all")}
                  >
                    <Trash2 />
                    <Trans>清空日志</Trans>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <LogFilters controller={c} />
      {c.error ? (
        <div
          role="status"
          className="text-destructive flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-sm"
        >
          <span>{describeError(c.error)}</span>
          <Button
            variant="outline"
            size="sm"
            density="adaptive"
            disabled={c.loading || c.busy}
            onClick={() => void c.reload()}
          >
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : null}
      {c.loading && !c.filtered.length ? (
        <p role="status" className="text-muted-foreground p-4 text-sm">
          <Trans>正在加载日志…</Trans>
        </p>
      ) : c.error && !c.filtered.length ? null : c.filtered.length ? (
        <LogList controller={c} />
      ) : (
        <Empty className="app-scroll-safe-end flex-1">
          <EmptyHeader>
            <EmptyTitle>
              {c.query ||
              c.source !== "all" ||
              c.result !== "all" ||
              c.range !== "all" ? (
                <Trans>无匹配结果</Trans>
              ) : (
                <Trans>暂无日志</Trans>
              )}
            </EmptyTitle>
            <EmptyDescription>
              <Trans>调整筛选条件或刷新后再试。</Trans>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <LogDialogs controller={c} />
    </main>
  );
}
