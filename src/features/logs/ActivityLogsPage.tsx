import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileClock, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { LogDeleteButton, LogPageActions, LogPageLayout, LogTableViewport } from "~/features/logs/LogPageLayout";
import * as ipc from "~/lib/ipc";
import type { ActivityLog } from "~/types";

function sourceLabel(value: string, t: ReturnType<typeof useLingui>["t"]) {
  if (value === "ssh") return "SSH";
  if (value === "sftp") return "SFTP";
  return t`局域网`;
}

function OverflowTooltipText({ value }: { value?: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const text = value || "-";

  const updateOverflow = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    setOverflowing(element.scrollWidth > element.clientWidth);
  }, []);

  useEffect(() => {
    updateOverflow();
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, updateOverflow]);

  const content = (
    <span ref={ref} className="block max-w-56 truncate" onMouseEnter={updateOverflow}>
      {text}
    </span>
  );

  if (!overflowing) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-normal break-words">{text}</TooltipContent>
    </Tooltip>
  );
}

export default function ActivityLogsPage() {
  const { t } = useLingui();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [range, setRange] = useState("all");
  const [loading, setLoading] = useState(false);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return logs.filter((log) => {
      if (source !== "all" && log.source !== source) return false;
      if (result !== "all" && log.result !== result) return false;
      if (range === "7d" && now - log.createdAt > 7 * 24 * 60 * 60 * 1000) return false;
      if (!q) return true;
      return [log.source, log.ip, log.requestType, log.result, log.detail ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [logs, query, range, result, source]);

  return (
    <LogPageLayout
      title={t`日志`}
      description={t`管理 SSH、SFTP 和局域网传输活动`}
      actions={<LogPageActions loading={loading} onRefresh={() => void load()} onClear={clear} />}
      filters={
        <>
          <InputGroup className="min-w-48 flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t`搜索地址、动作、详情`} />
          </InputGroup>
          <Select value={source} onValueChange={setSource}><SelectTrigger className="min-w-28"><SelectValue placeholder={t`来源`} /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all"><Trans>全部来源</Trans></SelectItem><SelectItem value="lan"><Trans>局域网</Trans></SelectItem><SelectItem value="ssh">SSH</SelectItem><SelectItem value="sftp">SFTP</SelectItem></SelectGroup></SelectContent></Select>
          <Select value={result} onValueChange={setResult}><SelectTrigger className="min-w-28"><SelectValue placeholder={t`结果`} /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all"><Trans>全部结果</Trans></SelectItem><SelectItem value="success"><Trans>成功</Trans></SelectItem><SelectItem value="failed"><Trans>失败</Trans></SelectItem></SelectGroup></SelectContent></Select>
          <Select value={range} onValueChange={setRange}><SelectTrigger className="min-w-28"><SelectValue placeholder={t`时间`} /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all"><Trans>全部时间</Trans></SelectItem><SelectItem value="7d"><Trans>近 7 天</Trans></SelectItem></SelectGroup></SelectContent></Select>
          <Badge className="flex h-8 items-center px-2.5" variant="outline">{filtered.length} / {logs.length}</Badge>
        </>
      }
    >
      <LogTableViewport>
        {filtered.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"><FileClock /><Trans>暂无日志</Trans></div>
        ) : (
          <Table className="min-w-[920px] table-fixed">
            <colgroup>
              <col className="w-40" />
              <col className="w-24" />
              <col className="w-36" />
              <col className="w-32" />
              <col className="w-24" />
              <col />
              <col className="w-12" />
            </colgroup>
            <TableHeader className="bg-card [&_th]:bg-card">
              <TableRow className="sticky top-0 z-20 bg-card shadow-xs">
                <TableHead><Trans>时间</Trans></TableHead>
                <TableHead><Trans>来源</Trans></TableHead>
                <TableHead><Trans>地址</Trans></TableHead>
                <TableHead><Trans>动作</Trans></TableHead>
                <TableHead><Trans>结果</Trans></TableHead>
                <TableHead><Trans>详情</Trans></TableHead>
                <TableHead className="sticky right-0 w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => (
                <TableRow className="group" key={log.id}>
                  <TableCell className="text-xs tabular-nums">{new Date(log.createdAt).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{sourceLabel(log.source, t)}</Badge></TableCell>
                  <TableCell className="truncate text-xs tabular-nums">{log.ip}</TableCell>
                  <TableCell className="truncate">{log.requestType}</TableCell>
                  <TableCell>{log.result === "success" ? t`成功` : t`失败`}</TableCell>
                  <TableCell className="max-w-56 text-muted-foreground">
                    <OverflowTooltipText value={log.detail} />
                  </TableCell>
                  <TableCell className="sticky right-0 w-12 bg-card transition-colors group-hover:bg-muted/50">
                    <LogDeleteButton onDelete={() => deleteLog(log.id)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </LogTableViewport>
    </LogPageLayout>
  );
}
