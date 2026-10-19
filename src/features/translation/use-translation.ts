import { useEffect, useRef, useState } from "react";

import type { TranslationRequest, TranslationSnapshot } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  translationCancel,
  translationDownload,
  translationRemove,
  translationRun,
  translationSelect,
  translationSnapshot,
} from "~/lib/ipc";

export function useTranslation() {
  const [snapshot, setSnapshot] = useState<TranslationSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [output, setOutput] = useState("");
  const [resultKey, setResultKey] = useState("");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const mounted = useRef(false);
  const active = useRef<string | null>(null);
  const translating = useRef<string | null>(null);
  const discarded = useRef<string | null>(null);
  const generation = useRef(0);
  const taskActive = snapshot?.task != null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = translating.current;
      translating.current = null;
      if (id) void translationCancel(id).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const version = ++generation.current;
      try {
        const value = await translationSnapshot();
        if (!cancelled && version === generation.current) setSnapshot(value);
      } catch (error) {
        if (!cancelled) setError(error);
      }
      if (!cancelled && (pending || taskActive)) timer = setTimeout(poll, 500);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, taskActive]);

  async function refresh(clearError = false) {
    const version = ++generation.current;
    try {
      const value = await translationSnapshot();
      if (mounted.current && version === generation.current) {
        setSnapshot(value);
        if (clearError) setError(null);
      }
    } catch (error) {
      if (mounted.current) setError(error);
    }
  }

  async function perform(action: (id: string) => Promise<void>) {
    if (active.current || snapshot?.task) return;
    const id = crypto.randomUUID();
    active.current = id;
    setPending(true);
    setError(null);
    try {
      await action(id);
    } catch (error) {
      if (
        mounted.current &&
        toIpcError(error).payload.code !== "translation:cancelled"
      )
        setError(error);
    } finally {
      active.current = null;
      if (mounted.current) {
        setPending(false);
        setStopping(false);
        await refresh();
      }
    }
  }

  function run(request: Omit<TranslationRequest, "requestId">) {
    return perform(async (id) => {
      translating.current = id;
      discarded.current = null;
      setRunning(true);
      setOutput("");
      setCancelled(false);
      setResultKey(JSON.stringify(request));
      let sequence = 0;
      try {
        const text = await translationRun(
          { ...request, requestId: id },
          (event) => {
            // 旧任务、重复序号和卸载后的正文不能写回当前结果。
            if (
              !mounted.current ||
              translating.current !== event.requestId ||
              event.sequence <= sequence
            )
              return;
            sequence = event.sequence;
            setOutput((text) => text + event.text);
          },
        );
        if (mounted.current && translating.current === id) setOutput(text);
      } catch (error) {
        // 因输入清空而取消的任务属于主动丢弃，不标记为“已停止”。
        if (
          mounted.current &&
          toIpcError(error).payload.code === "translation:cancelled" &&
          discarded.current !== id
        )
          setCancelled(true);
        throw error;
      } finally {
        translating.current = null;
        if (mounted.current) setRunning(false);
      }
    });
  }

  function clear() {
    setOutput("");
    setResultKey("");
    setCancelled(false);
    if (translating.current) {
      // 丢弃仍在进行的任务输出，并请求取消，避免清空后结果又写回。
      discarded.current = translating.current;
      translating.current = null;
      void stop();
    }
  }

  async function stop() {
    const id = active.current ?? snapshot?.task?.requestId;
    if (!id) return;
    setStopping(true);
    try {
      await translationCancel(id);
    } catch (error) {
      if (mounted.current) {
        setError(error);
        setStopping(false);
      }
    }
  }

  return {
    snapshot,
    error,
    output,
    resultKey,
    running,
    stopping,
    cancelled,
    busy: pending || taskActive,
    refresh,
    run,
    clear,
    stop,
    select: (id: string) => perform(() => translationSelect(id)),
    download: (id: string) =>
      perform((requestId) => translationDownload(id, requestId)),
    remove: (id: string) => perform(() => translationRemove(id)),
  };
}
