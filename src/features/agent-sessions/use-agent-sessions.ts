import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type {
  AgentSessionPage,
  AgentSessionSummary,
  SessionAgent,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  agentSessionsCancel,
  agentSessionsQuery,
  agentSessionsSnapshot,
} from "~/lib/ipc";
import { queryScopeGuard } from "~/lib/query-client";

import { sessionDateBounds, type SessionDateRange } from "./date-range";
import { agentSourcesQuery, agentStorageQuery } from "./queries";

export function useAgentSessions() {
  const client = useQueryClient();
  const sources = useQuery(agentSourcesQuery());
  const [agent, setAgent] = useState<SessionAgent | "all">("all");
  const [archive, setArchive] = useState<"all" | "active" | "archived">("all");
  const [sort, setSort] = useState<"updated" | "size">("updated");
  const [minBytes, setMinBytes] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [range, setRange] = useState<SessionDateRange>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [position, setPosition] = useState({ filter: "", offset: 0 });
  const [outcome, setOutcome] = useState<{
    identity: string;
    page: AgentSessionPage | null;
    error: ReturnType<typeof toIpcError> | null;
  } | null>(null);
  const [selection, setSelection] = useState<{
    filter: string;
    session: AgentSessionSummary | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<ReturnType<
    typeof toIpcError
  > | null>(null);
  const refreshRequest = useRef<string | null>(null);
  const mounted = useRef(true);
  const bounds = sessionDateBounds(range, from, to, new Date(), month);
  const generation = sources.data?.generation ?? "";
  const storage = useQuery(agentStorageQuery(generation));
  const filterIdentity = JSON.stringify([
    generation,
    agent,
    archive,
    sort,
    minBytes,
    debounced,
    bounds.from,
    bounds.to,
    bounds.valid,
  ]);
  const offset = position.filter === filterIdentity ? position.offset : 0;
  const selected =
    selection?.filter === filterIdentity ? selection.session : null;
  const identity = JSON.stringify([filterIdentity, offset, retry]);
  const current = outcome?.identity === identity ? outcome : null;
  const page = current?.page ?? null;
  const error = current?.error ?? null;
  const busy = !!generation && bounds.valid && !current;

  function setOffset(value: number) {
    setPosition({ filter: filterIdentity, offset: value });
  }

  function setSelected(session: AgentSessionSummary | null) {
    setSelection({ filter: filterIdentity, session });
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!generation || !bounds.valid) return;
    let active = true;
    const requestId = crypto.randomUUID();
    // 文本查询保持显式控制；关键词、匹配片段和原始对话不进入 Query 缓存。
    void agentSessionsQuery(
      {
        generation,
        agent: agent === "all" ? null : agent,
        archived: archive === "all" ? null : archive === "archived",
        sort,
        minBytes,
        search: debounced,
        from: bounds.from,
        to: bounds.to,
        offset,
        limit: 100,
      },
      requestId,
    )
      .then((result) => {
        if (active) setOutcome({ identity, page: result, error: null });
      })
      .catch((failure) => {
        if (active)
          setOutcome({ identity, page: null, error: toIpcError(failure) });
      });
    return () => {
      active = false;
      void agentSessionsCancel(requestId).catch(() => {});
    };
  }, [
    generation,
    agent,
    archive,
    sort,
    minBytes,
    debounced,
    bounds.from,
    bounds.to,
    bounds.valid,
    offset,
    identity,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (refreshRequest.current)
        void agentSessionsCancel(refreshRequest.current).catch(() => {});
    };
  }, []);

  async function refresh() {
    if (refreshRequest.current) return;
    const requestId = crypto.randomUUID();
    refreshRequest.current = requestId;
    setRefreshing(true);
    setRefreshError(null);
    const currentScope = queryScopeGuard(client, "agent-sessions");
    try {
      const snapshot = await agentSessionsSnapshot(true, requestId);
      if (mounted.current && currentScope()) {
        setAgent((selected) =>
          selected === "all" ||
          snapshot.sources.some(
            (source) => source.agent === selected && source.count > 0,
          )
            ? selected
            : "all",
        );
        client.setQueryData(agentSourcesQuery().queryKey, snapshot);
      }
    } catch (failure) {
      if (mounted.current) setRefreshError(toIpcError(failure));
    } finally {
      refreshRequest.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }

  function clearFilters() {
    setAgent("all");
    setArchive("all");
    setSort("updated");
    setMinBytes(null);
    setSearch("");
    setRange("all");
    setFrom("");
    setTo("");
  }

  return {
    sources,
    storage,
    agent,
    setAgent,
    archive,
    setArchive,
    sort,
    setSort,
    minBytes,
    setMinBytes,
    search,
    setSearch,
    range,
    setRange,
    from,
    setFrom,
    to,
    setTo,
    month,
    setMonth,
    bounds,
    page,
    error,
    selected,
    setSelected,
    offset,
    setOffset,
    refresh,
    refreshing,
    refreshError,
    clearFilters,
    filtered:
      agent !== "all" ||
      !!search ||
      range !== "all" ||
      archive !== "all" ||
      minBytes !== null,
    busy,
    retry: () => setRetry((value) => value + 1),
  };
}
