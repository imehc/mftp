import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileClock, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "~/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  LogDeleteButton,
  LogPageActions,
  LogPageLayout,
  LogTableViewport,
} from "~/features/logs/LogPageLayout";
import * as ipc from "~/lib/ipc";
import { useMediaQuery } from "~/lib/use-media-query";
import type { ActivityLog } from "~/types";
function sourceLabel(value: string, t: ReturnType<typeof useLingui>["t"]) {
  if (value === "ssh") return "SSH";
  if (value === "sftp") return "SFTP";
  return t`局域网`;
}
function OverflowTooltipText({ value }: { value?: string | null }) {
  const text = value || "-";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block truncate">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words whitespace-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
const desktopGridColumns =
  "grid-cols-[9rem_5rem_minmax(6rem,0.8fr)_minmax(7rem,1fr)_4.5rem_minmax(8rem,1.5fr)_2.75rem]";
export default function ActivityLogsPage() {
  const { t } = useLingui();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [range, setRange] = useState("all");
  const [loading, setLoading] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const desktop = useMediaQuery("(min-width: 768px)");
  async function load() {
    setLoading(true);
    try {
      setLogs(await ipc.activityLogs(500));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function clear() {
    try {
      await ipc.activityLogsClear();
      setLogs([]);
      toast.success(t`日志已清空`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function deleteLog(id: string) {
    try {
      await ipc.activityLogDelete(id);
      setLogs((current) => current.filter((log) => log.id !== id));
      toast.success(t`日志已删除`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  const filtered = (() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return logs.filter((log) => {
      if (source !== "all" && log.source !== source) return false;
      if (result !== "all" && log.result !== result) return false;
      if (range === "7d" && now - log.createdAt > 7 * 24 * 60 * 60 * 1000)
        return false;
      if (!q) return true;
      return [log.source, log.ip, log.requestType, log.result, log.detail ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  })();
  const rowVirtualizer = useVirtualizer({
    count: desktop ? filtered.length : 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 49,
    overscan: 12,
    scrollMargin: 41,
  });
  const cardVirtualizer = useVirtualizer({
    count: desktop ? 0 : filtered.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 124,
    overscan: 8,
  });
  return (
    <LogPageLayout
      title={t`日志`}
      description={t`管理 SSH、SFTP 和局域网传输活动`}
      actions={
        <LogPageActions
          loading={loading}
          onRefresh={() => void load()}
          onClear={clear}
        />
      }
      filters={
        <>
          <InputGroup className="min-w-48 flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t`搜索地址、动作、详情`}
            />
          </InputGroup>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="min-w-28">
              <SelectValue placeholder={t`来源`} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">
                  <Trans>全部来源</Trans>
                </SelectItem>
                <SelectItem value="lan">
                  <Trans>局域网</Trans>
                </SelectItem>
                <SelectItem value="ssh">SSH</SelectItem>
                <SelectItem value="sftp">SFTP</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={result} onValueChange={setResult}>
            <SelectTrigger className="min-w-28">
              <SelectValue placeholder={t`结果`} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">
                  <Trans>全部结果</Trans>
                </SelectItem>
                <SelectItem value="success">
                  <Trans>成功</Trans>
                </SelectItem>
                <SelectItem value="failed">
                  <Trans>失败</Trans>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="min-w-28">
              <SelectValue placeholder={t`时间`} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">
                  <Trans>全部时间</Trans>
                </SelectItem>
                <SelectItem value="7d">
                  <Trans>近 7 天</Trans>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Badge className="flex h-8 items-center px-2.5" variant="outline">
            {filtered.length} / {logs.length}
          </Badge>
        </>
      }
    >
      <LogTableViewport viewportRef={viewportRef}>
        {filtered.length === 0 ? (
          <Empty className="min-h-56">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileClock />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>暂无日志</Trans>
              </EmptyTitle>
              <EmptyDescription>
                <Trans>调整筛选条件或刷新后再试。</Trans>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div
              className="relative md:hidden"
              style={{
                height: `${cardVirtualizer.getTotalSize()}px`,
              }}
            >
              {cardVirtualizer.getVirtualItems().map((virtualCard) => {
                const log = filtered[virtualCard.index];
                if (!log) return null;
                return (
                  <div
                    key={log.id}
                    ref={cardVirtualizer.measureElement}
                    data-index={virtualCard.index}
                    className="absolute top-0 left-0 w-full px-2 pb-2"
                    style={{
                      transform: `translateY(${virtualCard.start}px)`,
                    }}
                  >
                    <article className="border-border rounded-md border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">
                              {sourceLabel(log.source, t)}
                            </Badge>
                            <Badge
                              variant={
                                log.result === "success"
                                  ? "secondary"
                                  : "destructive"
                              }
                            >
                              {log.result === "success" ? t`成功` : t`失败`}
                            </Badge>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium break-words">
                            {log.requestType}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs break-all tabular-nums">
                            {log.ip}
                          </p>
                        </div>
                        <LogDeleteButton onDelete={() => deleteLog(log.id)} />
                      </div>
                      {log.detail ? (
                        <p className="text-muted-foreground mt-2 text-xs break-words whitespace-pre-wrap">
                          {log.detail}
                        </p>
                      ) : null}
                    </article>
                  </div>
                );
              })}
            </div>
            <div className="hidden min-w-0 md:block">
              <div
                className={`border-border bg-card text-muted-foreground sticky top-0 z-20 grid h-10 items-center border-b px-2 text-xs font-medium shadow-xs ${desktopGridColumns}`}
              >
                <span>
                  <Trans>时间</Trans>
                </span>
                <span>
                  <Trans>来源</Trans>
                </span>
                <span>
                  <Trans>地址</Trans>
                </span>
                <span>
                  <Trans>动作</Trans>
                </span>
                <span>
                  <Trans>结果</Trans>
                </span>
                <span>
                  <Trans>详情</Trans>
                </span>
                <span />
              </div>
              <div
                className="relative"
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const log = filtered[virtualRow.index];
                  if (!log) return null;
                  return (
                    <div
                      key={log.id}
                      className={`border-border/60 hover:bg-muted/50 absolute top-0 left-0 grid w-full items-center border-b px-2 text-sm transition-colors ${desktopGridColumns}`}
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start - 41}px)`,
                      }}
                    >
                      <span className="truncate text-xs tabular-nums">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                      <span>
                        <Badge variant="outline">
                          {sourceLabel(log.source, t)}
                        </Badge>
                      </span>
                      <span className="truncate text-xs tabular-nums">
                        {log.ip}
                      </span>
                      <span className="truncate">{log.requestType}</span>
                      <span>
                        {log.result === "success" ? t`成功` : t`失败`}
                      </span>
                      <span className="text-muted-foreground min-w-0">
                        <OverflowTooltipText value={log.detail} />
                      </span>
                      <span className="flex justify-end">
                        <LogDeleteButton onDelete={() => deleteLog(log.id)} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </LogTableViewport>
    </LogPageLayout>
  );
}
