import { Trans, useLingui } from "@lingui/react/macro";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
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
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { describeError } from "~/lib/errors";

import LogDialogs from "./LogDialogs";
import LogFilters from "./LogFilters";
import LogList from "./LogList";
import { useActivityLogs } from "./use-activity-logs";

export default function ActivityLogsPage() {
  const { t } = useLingui();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const c = useActivityLogs();
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      <ToolPageHeader
        showHome={false}
        title={
          <Trans comment="持久保存的操作摘要列表页面标题，区别于运行期日志">
            历史日志
          </Trans>
        }
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t`返回`}
            onClick={() => {
              if (canGoBack) router.history.back();
              else void router.navigate({ to: "/settings" });
            }}
          >
            <ArrowLeft />
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
                    variant="destructive"
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
      <div className="app-page-width mx-auto flex min-h-0 w-full flex-1 flex-col">
        <LogFilters controller={c} />
        {c.error ? (
          <div
            role="status"
            className="text-destructive flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-sm"
          >
            <span>{describeError(c.error, t)}</span>
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
            </EmptyHeader>
          </Empty>
        )}
        <LogDialogs controller={c} />
      </div>
    </main>
  );
}
