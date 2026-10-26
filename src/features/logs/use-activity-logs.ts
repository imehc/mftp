import { useLingui } from "@lingui/react/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { ActivityLog, AppError } from "~/types";

import { filterLogs } from "./log-utils";

export function useActivityLogs({
  enabled = true,
  refreshKey = "",
  refreshInterval = 0,
}: {
  enabled?: boolean;
  refreshKey?: string;
  refreshInterval?: number;
} = {}) {
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
  const reading = useRef(0);
  const writing = useRef(false);
  const suppressed = useRef(new Set<string>());
  const sourceLabels: Record<string, string> = {
    ai: t({
      comment: "历史日志的来源名称及筛选选项，包含 AI 服务配置与请求操作",
      message: "AI 服务",
    }),
    lan: t`局域网`,
    ssh: "SSH",
    sftp: "SFTP",
    bt: "BT",
    todo: t`待办`,
    vault: t`密码本`,
    hosts: t`主机`,
    poetry: t`诗词库`,
    translation: t`离线翻译`,
    data: t`数据`,
    games: t`游戏`,
    runtime: t`运行时`,
  };
  const resultLabels: Record<string, string> = {
    success: t`成功`,
    failed: t`失败`,
    canceled: t`已取消`,
  };

  async function read(run: number) {
    reading.current++;
    try {
      if (typeof ipc.logsPage === "function") {
        const page = await ipc.logsPage(undefined, 500);
        if (mounted.current && generation.current === run) {
          setLogs(
            page.entries
              .map((entry) => entry.summary)
              .filter((entry): entry is ActivityLog => entry !== null)
              .filter((entry) => !suppressed.current.has(entry.id)),
          );
          setError(page.health.error);
        }
      } else {
        const next = await ipc.activityLogs(
          500,
          source === "all" ? undefined : source,
          result === "all" ? undefined : result,
        );
        if (mounted.current && generation.current === run) {
          setLogs(next.filter((entry) => !suppressed.current.has(entry.id)));
          setError(null);
        }
      }
    } catch (cause) {
      if (mounted.current && generation.current === run)
        setError(toIpcError(cause).payload);
    } finally {
      reading.current--;
      if (mounted.current && generation.current === run) setLoading(false);
    }
  }

  function reload() {
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readForFilter = useEffectEvent((run: number) => {
    setLoading(true);
    return read(run);
  });
  useEffect(() => {
    if (!enabled) return;
    const run = ++generation.current;
    const generationRef = generation;
    void readForFilter(run);
    return () => {
      generationRef.current++;
    };
  }, [source, result, enabled]);

  const refreshQuietly = useEffectEvent(() => {
    if (reading.current > 0 || !mounted.current) return;
    void read(++generation.current);
  });
  useEffect(() => {
    if (enabled) refreshQuietly();
  }, [enabled, refreshKey]);
  useEffect(() => {
    if (!enabled || !refreshInterval) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") refreshQuietly();
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [enabled, refreshInterval]);

  const visible = logs.filter(
    (entry) =>
      (source === "all" || entry.source === source) &&
      (result === "all" || entry.result === result),
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
    remove: async () => {
      if (!deleting || writing.current) return;
      const target = deleting;
      writing.current = true;
      generation.current++;
      setBusy(true);
      try {
        if (target === "all") {
          if (typeof ipc.logsClear === "function") await ipc.logsClear();
          else await ipc.activityLogsClear();
        } else if (typeof ipc.logsPage === "function") {
          await ipc.activityLogDelete(target.id);
        } else {
          await ipc.activityLogDelete(target.id);
        }
        if (!mounted.current) return;
        if (target === "all") suppressed.current.clear();
        else suppressed.current.add(target.id);
        setLogs((previous) =>
          target === "all"
            ? []
            : previous.filter((entry) => entry.id !== target.id),
        );
        setSelected(null);
        setDeleting(null);
        toast.success(target === "all" ? t`日志已清空` : t`日志已删除`);
      } catch (cause) {
        if (mounted.current) toast.error(describeError(cause, t));
      } finally {
        writing.current = false;
        if (mounted.current) setBusy(false);
      }
    },
  };
}

export type ActivityLogsController = ReturnType<typeof useActivityLogs>;
