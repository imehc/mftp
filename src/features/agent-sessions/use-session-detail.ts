import { useEffect, useRef, useState } from "react";

import type { AgentSessionDetail, AgentSessionSummary } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { agentSessionDetail, agentSessionsCancel } from "~/lib/ipc";

export function useSessionDetail(
  session: AgentSessionSummary,
  generation: string,
) {
  const [result, setResult] = useState<AgentSessionDetail | null>(null);
  const [error, setError] = useState<ReturnType<typeof toIpcError> | null>(
    null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [firstOffset, setFirstOffset] = useState(
    Math.floor((session.matchIndex ?? 0) / 100) * 100,
  );
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const request = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    alive.current = true;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    const start = Math.floor((session.matchIndex ?? 0) / 100) * 100;
    void agentSessionDetail(generation, session.key, start, requestId)
      .then((page) => {
        if (active) {
          setResult(page);
          setFirstOffset(start);
          setError(null);
        }
      })
      .catch((failure) => {
        if (active) setError(toIpcError(failure));
      })
      .finally(() => {
        if (request.current === requestId) request.current = null;
      });
    return () => {
      active = false;
      alive.current = false;
      if (request.current)
        void agentSessionsCancel(request.current).catch(() => {});
    };
  }, [generation, session.key, session.matchIndex, retry]);

  async function load(earlier: boolean) {
    if (!result || request.current) return;
    const offset = earlier ? Math.max(0, firstOffset - 100) : result.nextOffset;
    if (offset === null || (earlier && firstOffset === 0)) return;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await agentSessionDetail(
        generation,
        session.key,
        offset,
        requestId,
      );
      if (!alive.current) return;
      const all = [
        ...(earlier ? page.messages : result.messages),
        ...(earlier ? result.messages : page.messages),
      ];
      const unique = [
        ...new Map(all.map((message) => [message.index, message])).values(),
      ].sort((a, b) => a.index - b.index);
      // 保持一个有界阅读窗口；较早记录仍可向前加载，原始历史不截断。
      const messages =
        unique.length > 400
          ? earlier
            ? unique.slice(0, 400)
            : unique.slice(-400)
          : unique;
      const afterLast = (messages.at(-1)?.index ?? offset - 1) + 1;
      setResult({
        ...page,
        messages,
        // 向前翻页裁掉尾部时，后续游标须回到裁掉的位置，避免跳过记录。
        nextOffset: earlier
          ? afterLast < page.total
            ? afterLast
            : null
          : page.nextOffset,
      });
      setFirstOffset(messages[0]?.index ?? offset);
    } catch (failure) {
      if (alive.current) setError(toIpcError(failure));
    } finally {
      if (request.current === requestId) request.current = null;
      if (alive.current) setLoadingMore(false);
    }
  }

  return {
    result,
    error,
    busy: !result && !error,
    loadingMore,
    firstOffset,
    loadEarlier: () => load(true),
    loadMore: () => load(false),
    retry: () => setRetry((value) => value + 1),
  };
}
