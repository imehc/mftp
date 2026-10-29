import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { LoadingAction } from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { directoryQuery } from "~/features/ssh-sftp/queries";
import { toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { useHostsStore } from "~/store/hosts";
import type { AppError, Session } from "~/types";

export function useSftpNavigation(session: Session) {
  const sessionId = session.id;
  const [cwd, setCwd] = useState<string | null>(null);
  const client = useQueryClient();
  const directory = useQuery({
    ...directoryQuery(sessionId, cwd ?? "/"),
    enabled: false,
  });
  const entries = directory.data ?? [];
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction | null>(
    null,
  );
  // 目录读取的代数：慢请求晚到时不能覆盖用户刚刚选择的新目录。
  const generation = useRef(0);
  const mounted = useRef(true);

  const load = async (path: string, action: LoadingAction = "list") => {
    if (!mounted.current) return;
    const current = ++generation.current;
    setLoadError(null);
    setLoading(true);
    setLoadingAction(action);
    try {
      await client.query(directoryQuery(sessionId, path));
      if (generation.current !== current) return;
      setCwd(path);
    } catch (e) {
      if (generation.current === current) setLoadError(toIpcError(e).payload);
    } finally {
      if (generation.current === current) {
        setLoading(false);
        setLoadingAction(null);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      // 卸载后晚到的读取结果不再写回页面状态。
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  // load 与 goHome / 调用方共享；通过 effect event 读取最新闭包，
  // 使仅挂载时的导航 effect 不会在重渲染时重跑。
  const loadInEffect = useEffectEvent(load);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(null);
      setLoading(true);
      setLoadingAction("list");
      try {
        const host = useHostsStore
          .getState()
          .hosts.find((item) => item.id === session.hostId);
        const start = await ipc.sftpStartDir(sessionId, host?.defaultPath);
        if (!cancelled) await loadInEffect(start);
      } catch (e) {
        if (!cancelled) {
          setLoadError(toIpcError(e).payload);
          setLoading(false);
          setLoadingAction(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, session.hostId]);

  async function goHome() {
    // 主目录解析也属于导航请求，不能覆盖后发目录或卸载后的状态。
    if (!mounted.current) return;
    const current = ++generation.current;
    setLoadError(null);
    setLoading(true);
    setLoadingAction("home");
    try {
      const home = await ipc.sftpHome(sessionId);
      if (generation.current !== current) return;
      await load(home, "home");
    } catch (e) {
      if (generation.current !== current) return;
      setLoadError(toIpcError(e).payload);
      setLoading(false);
      setLoadingAction(null);
    }
  }

  return {
    cwd,
    entries,
    loading,
    loadingAction,
    loadError,
    load,
    goHome,
  };
}
