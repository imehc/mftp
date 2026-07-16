import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Session, SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { useHostsStore } from "~/store/hosts";
import type { LoadingAction } from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";

export function useSftpNavigation(session: Session) {
  const sessionId = session.id;
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction | null>(null);

  const load = useCallback(
    async (path: string, action: LoadingAction = "list") => {
      setLoading(true);
      setLoadingAction(action);
      try {
        const list = await ipc.sftpList(sessionId, path);
        setEntries(list);
        setCwd(path);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoading(false);
        setLoadingAction(null);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadingAction("list");
      try {
        const host = useHostsStore
          .getState()
          .hosts.find((item) => item.id === session.hostId);
        const start = await ipc.sftpStartDir(sessionId, host?.defaultPath);
        if (!cancelled) await load(start);
      } catch (e) {
        if (!cancelled) {
          toast.error(String(e));
          setLoading(false);
          setLoadingAction(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, session.hostId, load]);

  async function goHome() {
    setLoading(true);
    setLoadingAction("home");
    try {
      const home = await ipc.sftpHome(sessionId);
      await load(home, "home");
    } catch (e) {
      toast.error(String(e));
      setLoading(false);
      setLoadingAction(null);
    }
  }

  return {
    cwd,
    entries,
    loading,
    loadingAction,
    load,
    goHome,
  };
}
