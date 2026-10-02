import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import * as ipc from "~/lib/ipc";
import { describeError, toIpcError } from "~/lib/errors";
import type { ActivityLog, AppError } from "~/types";
import { filterLogs } from "./log-utils";

export function useActivityLogs() {
  const { t } = useLingui();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [range, setRange] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ActivityLog | null>(null);
  const [deleting, setDeleting] = useState<ActivityLog | "all" | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const writing = useRef(false);
  const sourceLabels: Record<string, string> = {
    lan: t`局域网`,
    ssh: "SSH",
    sftp: "SFTP",
    bt: "BT",
    todo: t`待办`,
    vault: t`密码本`,
    hosts: t`主机`,
    poetry: t`诗词库`,
    data: t`数据`,
    games: t`游戏`,
  };
  const resultLabels: Record<string, string> = {
    success: t`成功`,
    failed: t`失败`,
    canceled: t`已取消`,
  };
  async function read(run: number) {
    try {
      const next = await ipc.activityLogs(
        500,
        source === "all" ? undefined : source,
        result === "all" ? undefined : result,
      );
      if (mounted.current && generation.current === run) setLogs(next);
    } catch (cause) {
      if (mounted.current && generation.current === run)
        setError(toIpcError(cause).payload);
    } finally {
      if (mounted.current && generation.current === run) setLoading(false);
    }
  }
  function reload() {
    if (writing.current) return;
    setLoading(true);
    setError(null);
    return read(++generation.current);
  }
  function changeSource(value: string) {
    if (value === source) return;
    setLoading(true);
    setError(null);
    setSource(value);
  }
  function changeResult(value: string) {
    if (value === result) return;
    setLoading(true);
    setError(null);
    setResult(value);
  }
  const readForFilter = useEffectEvent(read);
  useEffect(() => {
    mounted.current = true;
    void readForFilter(++generation.current);
    return () => {
      mounted.current = false;
    };
  }, [source, result]);
  // 先使旧读取失效，写失败保留确认和原数据，禁止自动重放删除。
  async function remove() {
    if (!deleting || writing.current) return;
    const target = deleting;
    writing.current = true;
    generation.current++;
    setLoading(false);
    setBusy(true);
    try {
      if (target === "all") await ipc.activityLogsClear();
      else await ipc.activityLogDelete(target.id);
      if (!mounted.current) return;
      setLogs((previous) =>
        target === "all" ? [] : previous.filter((x) => x.id !== target.id),
      );
      setSelected(null);
      setDeleting(null);
      toast.success(target === "all" ? t`日志已清空` : t`日志已删除`);
    } catch (cause) {
      if (mounted.current) toast.error(describeError(cause));
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const visible = logs.filter(
    (x) =>
      (source === "all" || x.source === source) &&
      (result === "all" || x.result === result),
  );
  const filtered = filterLogs(visible, query, range, {
    ...sourceLabels,
    ...resultLabels,
  });
  return {
    logs,
    filtered,
    query,
    setQuery,
    source,
    setSource: changeSource,
    result,
    setResult: changeResult,
    range,
    setRange,
    loading,
    error,
    busy,
    reload,
    sourceLabels,
    resultLabels,
    selected,
    setSelected,
    deleting,
    setDeleting,
    remove,
  };
}
export type ActivityLogsController = ReturnType<typeof useActivityLogs>;
