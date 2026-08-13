import { useCallback, useEffect, useRef, useState } from "react";
import { msg } from "@lingui/core/macro";
import type { Session, SystemStats } from "~/types";
import * as ipc from "~/lib/ipc";
import { translate } from "~/i18n/translate";
import { useSessionsStore } from "~/store/sessions";

export type RefreshIntervalMs = 0 | 2000 | 5000 | 10000;

/// Upper bound for one stats round-trip. The backend caps its single remote
/// exec at 10s, so anything past this margin means the invoke itself hung.
const REFRESH_TIMEOUT_MS = 12_000;
/// Stop auto-refresh after this many straight failures so a dead link is not
/// hammered forever; a manual refresh resumes the loop.
const MAX_CONSECUTIVE_FAILURES = 3;
/// Ring buffer cap: 120 points ≈ 10 minutes at the default 5s interval.
const HISTORY_LIMIT = 120;

export interface MonitorPoint {
  /** Sample wall-clock time (ms). */
  t: number;
  /** CPU used percent 0-100. */
  cpu: number;
  /** Memory used percent 0-100. */
  mem: number;
  /** Network rates summed across interfaces, bytes/s. */
  rx: number;
  tx: number;
  /** Disk IO rates summed across devices, bytes/s. */
  read: number;
  write: number;
}

// The panel unmounts whenever the user switches the session view, so chart
// history must survive outside React state. Keyed by backend session id.
const historyMap = new Map<string, MonitorPoint[]>();

// Prune history for sessions that no longer exist (closed tabs).
useSessionsStore.subscribe((state) => {
  const alive = new Set(state.sessions.map((session) => session.id));
  for (const id of historyMap.keys()) {
    if (!alive.has(id)) historyMap.delete(id);
  }
});

function toPoint(stats: SystemStats): MonitorPoint {
  const memTotal = stats.memory.total;
  return {
    t: Date.now(),
    cpu: stats.cpu.used,
    mem: memTotal > 0 ? (stats.memory.used / memTotal) * 100 : 0,
    rx: stats.network.reduce((sum, i) => sum + i.rxBytesPerSec, 0),
    tx: stats.network.reduce((sum, i) => sum + i.txBytesPerSec, 0),
    read: stats.diskIo.reduce((sum, d) => sum + d.readBytesPerSec, 0),
    write: stats.diskIo.reduce((sum, d) => sum + d.writeBytesPerSec, 0),
  };
}

function fetchSystemStats(sessionId: string): Promise<SystemStats> {
  return Promise.race([
    ipc.sshSystemStats(sessionId),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(translate(msg`监控采集超时`))),
        REFRESH_TIMEOUT_MS,
      );
    }),
  ]);
}

export function useSystemMonitor(session: Session) {
  const sessionId = session.id;
  const [data, setData] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<MonitorPoint[]>(
    () => historyMap.get(sessionId) ?? [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState<RefreshIntervalMs>(5000);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);

  const refresh = useCallback(async () => {
    // One request at a time: a slow link must not queue up polls behind the
    // shared SSH connection lock (that is what made it degrade over time).
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const next = await fetchSystemStats(sessionId);
      if (seqRef.current !== seq) return;
      failuresRef.current = 0;
      const points = [...(historyMap.get(sessionId) ?? []), toPoint(next)].slice(
        -HISTORY_LIMIT,
      );
      historyMap.set(sessionId, points);
      setHistory(points);
      setData(next);
      setError(null);
      setPaused(false);
      setLastUpdated(Date.now());
    } catch (e) {
      if (seqRef.current !== seq) return;
      failuresRef.current += 1;
      setError(String(e));
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) setPaused(true);
    } finally {
      inFlightRef.current = false;
      if (seqRef.current === seq) setLoading(false);
    }
  }, [sessionId]);

  /** Manual retry: clears the failure streak and resumes auto-refresh. */
  const retry = useCallback(() => {
    failuresRef.current = 0;
    setPaused(false);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setHistory(historyMap.get(sessionId) ?? []);
    void refresh();
  }, [sessionId, refresh]);

  useEffect(() => {
    if (intervalMs === 0 || paused) return;
    const timer = window.setInterval(() => {
      // Skip ticks while minimized/hidden; the next visible tick catches up.
      if (document.hidden) return;
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, paused, refresh]);

  return {
    data,
    history,
    loading,
    error,
    paused,
    refresh,
    retry,
    intervalMs,
    setIntervalMs,
    lastUpdated,
  };
}
