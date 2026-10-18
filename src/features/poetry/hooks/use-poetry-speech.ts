import { useLingui } from "@lingui/react/macro";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { SpeechCatalog, SpeechSnapshot } from "~/bindings";
import { describeError } from "~/lib/errors";
import { SPEECH_STATE } from "~/lib/events";
import * as ipc from "~/lib/ipc";

import { newerSpeechSnapshot, PoetrySpeechSession } from "../speech-session";

export function usePoetrySpeech(scope: string | null) {
  const { t } = useLingui();
  const [catalog, setCatalog] = useState<SpeechCatalog | null>(null);
  const [snapshot, setSnapshot] = useState<SpeechSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setCatalog(null);
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
    void Promise.all([ipc.speechCatalog(), subscription])
      .then(([result]) => {
        if (active) {
          setCatalog(result);
          setReady(true);
        }
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
    if (!session || !ready) return;
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
    if (!ready) {
      setError(null);
      setAttempt((value) => value + 1);
      return;
    }
    setPending((value) => value + 1);
    setError(null);
    try {
      const result = await ipc.speechCatalog();
      if (sessionRef.current) setCatalog(result);
    } catch (value) {
      if (sessionRef.current) setError(value);
    } finally {
      if (sessionRef.current) setPending((value) => value - 1);
    }
  }

  return {
    catalog,
    snapshot,
    error: error ?? snapshot?.error,
    busy: pending > 0,
    ready,
    run,
    refresh,
  };
}
