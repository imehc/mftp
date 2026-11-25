import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import AppPageLayout from "~/components/AppPageLayout";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";

import { SessionDetail, SessionDetailEmpty } from "./SessionDetail";
import { SessionFilters } from "./SessionFilters";
import { SessionResults } from "./SessionResults";
import { SessionSources } from "./SessionSources";
import { SessionViewControls } from "./SessionViewControls";
import { useAgentSessions } from "./use-agent-sessions";

export default function AgentSessionsTool() {
  const { t } = useLingui();
  const c = useAgentSessions();
  const [onlyChat, setOnlyChat] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const sizes = new Map(
    c.storage.data?.items.map((item) => [item.key, item.bytes]) ?? [],
  );
  const failure = c.refreshError ?? c.sources.error ?? c.error;
  const issues = [...(c.sources.data?.issues ?? []), ...(c.page?.issues ?? [])];
  return (
    <AppPageLayout
      title={<Trans>Agent 会话</Trans>}
      width="full"
      scroll="content"
      contentDensity="compact"
      contentClassName="@container/session"
      headerActionsClassName="w-full md:w-auto"
      actions={
        <>
          <SessionFilters controller={c} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t({
              message: "刷新记录",
              comment: "标题栏图标按钮，重新读取本机 agent 会话目录",
            })}
            title={t({
              message: "刷新记录",
              comment: "标题栏图标按钮，重新读取本机 agent 会话目录",
            })}
            disabled={c.refreshing || c.sources.isFetching}
            onClick={() => void c.refresh()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(
                (c.refreshing || c.sources.isFetching) &&
                  "motion-safe:animate-spin",
              )}
            />
          </Button>
          <SessionViewControls
            onlyChat={onlyChat}
            expanded={expanded}
            onOnlyChatChange={(value) => {
              setOnlyChat(value);
              if (value) setExpanded(false);
            }}
            onExpandedChange={(value) => {
              setExpanded(value);
              if (value) setOnlyChat(false);
            }}
          />
        </>
      }
    >
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>
            {describeError(failure, t)}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                c.sources.error
                  ? void c.sources.refetch()
                  : c.error
                    ? c.retry()
                    : void c.refresh()
              }
            >
              <Trans>重试</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {issues.length > 0 && (
        <Alert>
          <AlertDescription>
            <Trans>部分来源无法读取</Trans>
            <details>
              <summary className="cursor-pointer">
                <Trans comment="查看会话扫描失败或超限的来源文件">
                  查看原因
                </Trans>
              </summary>
              {issues.map((issue, index) => (
                <p key={index} className="mt-2 [overflow-wrap:anywhere]">
                  {issue.path} · {describeError(issue.error, t)}
                </p>
              ))}
            </details>
          </AlertDescription>
        </Alert>
      )}
      {c.storage.error && (
        <Alert variant="destructive">
          <AlertDescription>
            <Trans>存储占用统计失败</Trans> ·{" "}
            {describeError(c.storage.error, t)}{" "}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void c.storage.refetch()}
            >
              <Trans>重试</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {c.storage.data?.complete === false && (
        <Alert>
          <AlertDescription>
            <Trans>部分会话占用未能计量，已显示可确认的记录大小。</Trans>
          </AlertDescription>
        </Alert>
      )}
      {c.sources.isPending ? (
        <div
          role="status"
          className="text-muted-foreground flex min-h-64 flex-1 items-center justify-center gap-2 text-sm"
        >
          <Spinner />
          <Trans>正在扫描本机会话</Trans>
        </div>
      ) : (
        c.sources.data && (
          <div className="border-border bg-card grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border @[44rem]/session:grid-cols-[20rem_minmax(0,1fr)] @[56rem]/session:grid-cols-[15rem_20rem_minmax(0,1fr)]">
            <SessionSources
              snapshot={c.sources.data}
              selected={c.agent}
              onSelect={c.setAgent}
              storage={c.storage.data?.sources}
            />
            <div className="contents">
              <div
                className={cn(
                  "flex min-h-0 flex-col *:flex-1",
                  c.selected && "hidden @[44rem]/session:flex",
                )}
              >
                <SessionResults
                  page={c.page}
                  selected={c.selected?.key ?? null}
                  busy={c.busy}
                  filtered={c.filtered}
                  offset={c.offset}
                  onSelect={c.setSelected}
                  onPage={c.setOffset}
                  onClear={c.clearFilters}
                  sizes={sizes}
                />
              </div>
              {c.selected ? (
                <SessionDetail
                  key={`${c.sources.data.generation}:${c.selected.key}`}
                  session={c.selected}
                  generation={c.sources.data.generation}
                  search={c.search}
                  onlyChat={onlyChat}
                  expanded={expanded}
                  partialNotified={issues.some(
                    (issue) => issue.path === c.selected?.path,
                  )}
                  onOnlyChatChange={setOnlyChat}
                  onClose={() => c.setSelected(null)}
                />
              ) : (
                <SessionDetailEmpty />
              )}
            </div>
          </div>
        )
      )}
    </AppPageLayout>
  );
}
