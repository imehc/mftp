import { Trans, useLingui } from "@lingui/react/macro";
import {
  useCanGoBack,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { hasExecutionLogContent } from "~/features/connection-diagnostics/execution-log-content";
import ExecutionLogDetailView from "~/features/connection-diagnostics/ExecutionLogDetailView";
import HistoryLogDetailView from "~/features/logs/HistoryLogDetailView";
import { useActivityLogs } from "~/features/logs/use-activity-logs";
import { previousAppLocation } from "~/features/navigation/back-history";
import { runMobileBackTransition } from "~/features/navigation/mobile-back-transition";

import { useActivityViewStore } from "./activity-view-store";
import { ActivityCenter } from "./ActivityCenter";
import { useActivityExecutionLogs } from "./ActivityProvider";

export default function ActivityPage() {
  const { t } = useLingui();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const search = useSearch({ from: "/activity" });
  const navigate = useNavigate({ from: "/activity" });
  const savedTab = useActivityViewStore((state) => state.tab);
  const setTab = useActivityViewStore((state) => state.setTab);
  const tab = search.tab ?? savedTab;
  const logs = useActivityExecutionLogs();
  const history = useActivityLogs({
    enabled: tab === "logs" || !!search.operation || !!search.history,
    refreshKey: logs.operations
      .map((operation) => `${operation.id}:${operation.status}`)
      .join("|"),
    refreshInterval: 5000,
  });
  const unavailableOperation = useRef<string | null>(null);
  const summary = history.logs.find((item) =>
    search.history
      ? item.id === search.history
      : !!search.operation && item.operationId === search.operation,
  );
  const operation = logs.operations.find(
    (item) => item.id === (search.operation ?? summary?.operationId),
  );
  const selected =
    operation && (summary || hasExecutionLogContent(operation))
      ? operation
      : null;
  const requested = search.operation ?? search.history;

  const closeDetail = (event?: { detail: number }) => {
    const back = canGoBack && router.state.location.state.activityLogDetail;
    const href = back
      ? previousAppLocation(router.history)?.href
      : router.buildLocation({ to: "/activity", search: { tab: "logs" } }).href;
    runMobileBackTransition(
      router,
      href ?? "/activity",
      () => {
        if (back) router.history.back();
        else
          return navigate({
            search: { tab: "logs" },
            replace: true,
            state: { activityLogDetail: false },
          });
      },
      (event?.detail ?? 0) > 0,
    );
  };

  useEffect(() => {
    setTab(tab);
  }, [tab, setTab]);
  useEffect(() => {
    if (!requested) {
      unavailableOperation.current = null;
      return;
    }
    if (
      logs.loading ||
      logs.error ||
      history.loading ||
      history.error ||
      selected ||
      summary ||
      unavailableOperation.current === requested
    )
      return;
    unavailableOperation.current = requested;
    toast(
      t({
        comment:
          "日志链接不在当前有界列表或内存记录中，不能断言数据库中也已删除",
        message: "当前列表中未找到这条记录",
      }),
    );
    void navigate({ search: { tab: "logs" }, replace: true });
  }, [
    requested,
    logs.loading,
    logs.error,
    history.loading,
    history.error,
    selected,
    summary,
    navigate,
    t,
  ]);
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      {selected ? (
        <ExecutionLogDetailView
          key={selected.id}
          operation={selected}
          onBack={closeDetail}
          history={summary}
          historyError={history.error}
        />
      ) : summary ? (
        <HistoryLogDetailView
          log={summary}
          controller={history}
          execution={logs}
          onBack={closeDetail}
        />
      ) : (
        <>
          <ToolPageHeader
            showHome={false}
            showActivity={false}
            title={<Trans>活动</Trans>}
            leading={
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={t`返回`}
                onClick={(event) => {
                  if (requested) {
                    closeDetail(event);
                    return;
                  }
                  runMobileBackTransition(
                    router,
                    previousAppLocation(router.history)?.href ?? "/",
                    () => {
                      if (canGoBack) router.history.back();
                      else return router.navigate({ to: "/" });
                    },
                    event.detail > 0,
                  );
                }}
              >
                <ArrowLeft />
              </Button>
            }
          />
          <AppPageContent
            width="full"
            scroll="content"
            density="compact"
            bottomInset="scroll"
          >
            <ActivityCenter
              tab={tab}
              history={history}
              onTabChange={(next) => {
                setTab(next);
                void navigate({ search: { tab: next }, replace: true });
              }}
            />
          </AppPageContent>
        </>
      )}
    </main>
  );
}
