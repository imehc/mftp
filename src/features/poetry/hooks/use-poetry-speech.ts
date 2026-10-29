import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { SpeechSnapshot } from "~/bindings";
import { describeError } from "~/lib/errors";
import { SPEECH_STATE } from "~/lib/events";
import * as ipc from "~/lib/ipc";

import { speechCatalogQuery } from "../queries";
import { newerSpeechSnapshot, PoetrySpeechSession } from "../speech-session";

export function usePoetrySpeech(scope: string | null) {
  const { t } = useLingui();
  const catalogRead = useQuery({ ...speechCatalogQuery(), enabled: !!scope });
  const catalog = catalogRead.data ?? null;
  const [snapshot, setSnapshot] = useState<SpeechSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setSnapshot(null);
    setError(null);
    setPending(0);
    setReady(false);
  }
  const sessionRef = useRef<PoetrySpeechSession | null>(null);
  // 清理错误仍应展示；语言切换不重建朗读会话。
  const cleanupError = useRef((value: unknown) =>
    toast.error(describeError(value, t)),
  );

  useEffect(() => {
    cleanupError.current = (value) => toast.error(describeError(value, t));
  }, [t]);

  useEffect(() => {
    if (!scope) return;
    let active = true;
    let unlisten: (() => void) | undefined;

    const receive = (value: SpeechSnapshot) => {
      if (active) setSnapshot((current) => newerSpeechSnapshot(current, value));
    };

    const session = new PoetrySpeechSession(ipc, receive);
    sessionRef.current = session;
    const subscription = listen<SpeechSnapshot>(SPEECH_STATE, ({ payload }) => {
      if (session.accepts(payload)) receive(payload);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    void subscription
      .then(() => {
        if (active) setReady(true);
      })
      .catch((value: unknown) => {
        if (active) setError(value);
      });

    // WebView 隐藏、刷新或关闭时也停止，不依赖 React 一定先卸载。
    const stop = () => {
      void session.control("stop").catch(cleanupError.current);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
    };

    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      sessionRef.current = null;
      unlisten?.();
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      void session.dispose().catch(cleanupError.current);
    };
  }, [attempt, scope]);

  async function run(
    operation: (session: PoetrySpeechSession) => Promise<void>,
  ) {
    const session = sessionRef.current;
    if (!session || !ready || !catalog) return;
    setPending((value) => value + 1);
    setError(null);
    try {
      await operation(session);
    } catch (value) {
      if (sessionRef.current === session) setError(value);
    } finally {
      if (sessionRef.current === session) setPending((value) => value - 1);
    }
  }

  async function refresh() {
    if (!scope) return;
    setError(null);
    if (!ready) setAttempt((value) => value + 1);
    await catalogRead.refetch({ cancelRefetch: false });
  }

  return {
    catalog,
    snapshot,
    error: error ?? catalogRead.error ?? snapshot?.error,
    busy: pending > 0 || catalogRead.isFetching,
    ready: ready && !!catalog,
    run,
    refresh,
  };
}
