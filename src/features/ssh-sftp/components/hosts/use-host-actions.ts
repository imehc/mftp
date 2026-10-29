import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { toast } from "sonner";

import { describeError } from "~/lib/errors";
import { useHostsStore } from "~/store/hosts";
import { useSessionsStore } from "~/store/sessions";
import type { Host } from "~/types";

export function useHostActions(singleSession: boolean) {
  const { t } = useLingui();
  const keys = useHostsStore((s) => s.keys);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const reorderHosts = useHostsStore((s) => s.reorderHosts);
  const openSession = useSessionsStore((s) => s.openSession);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const setActive = useSessionsStore((s) => s.setActive);
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const [pendingHost, setPendingHost] = useState<Host | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null);
  const [disconnecting, setDisconnecting] = useState<Set<string>>(
    () => new Set(),
  );
  const sessionByHost = (() => {
    const map = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (session.status === "connecting" || session.status === "connected") {
        map.set(session.hostId, session);
      }
    }
    return map;
  })();

  async function openConnection(host: Host, passphrase?: string) {
    if (singleSession) {
      // 移动工作区只保留当前连接，切换主机时先释放旧终端和文件任务。
      const others = useSessionsStore
        .getState()
        .sessions.filter((session) => session.hostId !== host.id);
      for (const session of others) {
        await closeSession(session.id);
      }
    }
    return openSession(host, passphrase);
  }

  async function connect(host: Host) {
    const existing = sessionByHost.get(host.id);
    if (existing) {
      setActive(existing.id);
      return;
    }
    // 带口令的密钥需要先让用户输入口令才能连接。
    if (host.authType === "key") {
      const key = keys.find((k) => k.id === host.keyId);
      if (key?.hasPassphrase) {
        setPendingHost(host);
        return;
      }
    }
    try {
      await openConnection(host);
    } catch (e) {
      toast.error(describeError(e, t));
    }
  }

  async function disconnect(host: Host) {
    const session = sessionByHost.get(host.id);
    if (!session) return;
    setDisconnecting((current) => new Set(current).add(host.id));
    try {
      await closeSession(session.id);
      const hostLabel = host.label;
      toast.success(t`已断开 ${hostLabel}`);
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setDisconnecting((current) => {
        const next = new Set(current);
        next.delete(host.id);
        return next;
      });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.label;
    try {
      await deleteHost(deleteTarget.id);
      toast.success(t`已删除主机 ${name}`);
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setDeleteTarget(null);
    }
  }

  async function reorder(ids: string[]) {
    try {
      await reorderHosts(ids);
    } catch (error) {
      toast.error(describeError(error, t));
    }
  }

  async function submitPassphrase(passphrase: string) {
    const host = pendingHost;
    setPendingHost(null);
    if (host) {
      try {
        await openConnection(host, passphrase);
      } catch (e) {
        toast.error(describeError(e, t));
      }
    }
  }

  return {
    activeId,
    sessionByHost,
    pendingHost,
    setPendingHost,
    deleteTarget,
    setDeleteTarget,
    disconnecting,
    connect,
    disconnect,
    confirmDelete,
    reorder,
    submitPassphrase,
  };
}
