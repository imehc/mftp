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
  const unavailableOperation = useRef<string | null>(null);
  const operation = logs.operations.find(
    (item) => item.id === search.operation,
  );
  const selected =
    operation && hasExecutionLogContent(operation) ? operation : null;

  const closeDetail = () => {
    if (canGoBack && router.state.location.state.activityLogDetail)
      router.history.back();
    else
      void navigate({
        search: { tab: "logs" },
        replace: true,
        state: { activityLogDetail: false },
      });
  };

  useEffect(() => {
    setTab(tab);
  }, [tab, setTab]);
  useEffect(() => {
    if (!search.operation) {
      unavailableOperation.current = null;
      return;
    }
    if (
      logs.loading ||
      logs.error ||
      selected ||
      unavailableOperation.current === search.operation
    )
      return;
    unavailableOperation.current = search.operation;
    toast(
      t({
        comment: "活动详情正在查看的记录已被清空或因容量限制淘汰",
        message: "该记录已不再保留",
      }),
    );
    void navigate({ search: { tab: "logs" }, replace: true });
  }, [search.operation, logs.loading, logs.error, selected, navigate, t]);
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
                onClick={() => {
                  if (search.operation) {
                    closeDetail();
                    return;
                  }
                  if (canGoBack) router.history.back();
                  else void router.navigate({ to: "/" });
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
