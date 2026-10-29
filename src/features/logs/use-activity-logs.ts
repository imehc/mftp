import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { ActivityLog } from "~/types";

import { filterLogs } from "./log-utils";
import { clearLogQueries, logPageKey, logPageQuery } from "./queries";

export function useActivityLogs({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const { t } = useLingui();
  const client = useQueryClient();
  const page = useQuery({ ...logPageQuery(), enabled });
  const logs =
    page.data?.entries
      .map((entry) => entry.summary)
      .filter((entry): entry is ActivityLog => entry !== null) ?? [];
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [range, setRange] = useState("all");
  const loading = page.isLoading;
  const error = page.error?.payload ?? page.data?.health.error ?? null;
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ActivityLog | null>(null);
  const [deleting, setDeleting] = useState<ActivityLog | "all" | null>(null);
  const mounted = useRef(false);
  const writing = useRef(false);
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

  async function reload() {
    await page.refetch({ cancelRefetch: false });
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    setSource,
    result,
    setResult,
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
      setBusy(true);
      try {
        if (target === "all") await clearLogQueries(client);
        else {
          await ipc.activityLogDelete(target.id);
          await client.cancelQueries({ queryKey: logPageKey });
          client.setQueryData(logPageQuery().queryKey, (previous) =>
            previous
              ? {
                  ...previous,
                  entries: previous.entries.map((entry) =>
                    entry.summary?.id === target.id
                      ? { ...entry, summary: null }
                      : entry,
                  ),
                }
              : previous,
          );
        }
        if (!mounted.current) return;
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
