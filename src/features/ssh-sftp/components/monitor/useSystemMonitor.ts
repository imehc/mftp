import { msg } from "@lingui/core/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { translate } from "~/i18n/translate";
import { toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { useSessionsStore } from "~/store/sessions";
import type { AppError, Session, SystemStats } from "~/types";

export type RefreshIntervalMs = 0 | 2000 | 5000 | 10000;

/// 单次统计往返的上限。后端把单次远程执行上限设为 10s，因此超过这个
/// 余量说明 invoke 本身卡住了。
const REFRESH_TIMEOUT_MS = 12_000;
/// 连续失败达到此次数后停止自动刷新，避免一直猛打已失效的连接；
/// 手动刷新会重新启动循环。
const MAX_CONSECUTIVE_FAILURES = 3;
/// 环形缓冲上限：默认 5s 间隔下约 10 分钟的 120 个点。
const HISTORY_LIMIT = 120;

export interface MonitorPoint {
  /** 采样时刻（毫秒时间戳）。 */
  t: number;
  /** CPU 占用百分比 0–100。 */
  cpu: number;
  /** 内存占用百分比 0–100。 */
  mem: number;
  /** 各网卡速率之和，bytes/s。 */
  rx: number;
  tx: number;
  /** 各磁盘 I/O 速率之和，bytes/s。 */
  read: number;
  write: number;
}

// 用户切换会话视图时面板会卸载，因此图表历史必须存活于 React state 之外。
// 以后端会话 id 为键。
const historyMap = new Map<string, MonitorPoint[]>();

// 清理已不存在（已关闭标签）的会话历史。
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

async function fetchSystemStats(sessionId: string): Promise<SystemStats> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ipc.sshSystemStats(sessionId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(translate(msg`监控采集超时`))),
          REFRESH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function useSystemMonitor(session: Session) {
  const sessionId = session.id;
  const [data, setData] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<MonitorPoint[]>(
    () => historyMap.get(sessionId) ?? [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState<RefreshIntervalMs>(5000);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);

  const refresh = async () => {
    // 同一时刻只发一个请求：慢链路不能在共享的 SSH 连接锁后面堆积轮询
    // （正是这点让监控随时间劣化）。
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const next = await fetchSystemStats(sessionId);
      if (seqRef.current !== seq) return;
      failuresRef.current = 0;
      const points = [
        ...(historyMap.get(sessionId) ?? []),
        toPoint(next),
      ].slice(-HISTORY_LIMIT);
      historyMap.set(sessionId, points);
      setHistory(points);
      setData(next);
      setError(null);
      setPaused(false);
      setLastUpdated(Date.now());
    } catch (e) {
      if (seqRef.current !== seq) return;
      failuresRef.current += 1;
      setError(toIpcError(e).payload);
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) setPaused(true);
    } finally {
      inFlightRef.current = false;
      if (seqRef.current === seq) setLoading(false);
    }
  };

  /** 手动重试：清除连续失败计数并恢复自动刷新。 */
  const retry = () => {
    failuresRef.current = 0;
    setPaused(false);
    void refresh();
  };

  // refresh 与 retry() / 调用方共享；通过 effect event 读取，使轮询
  // 定时器不会在每次渲染时都被拆除。
  const refreshInEffect = useEffectEvent(refresh);
  useEffect(() => {
    let cancelled = false;
    // 卸载使当前代次失效，晚到的采样不能继续写入页面或历史。
    queueMicrotask(() => {
      if (cancelled) return;
      setHistory(historyMap.get(sessionId) ?? []);
      void refreshInEffect();
    });
    return () => {
      cancelled = true;
      seqRef.current += 1;
    };
  }, [sessionId]);
  useEffect(() => {
    if (intervalMs === 0 || paused) return;
    const timer = window.setInterval(() => {
      // 最小化 / 隐藏时跳过快照；下一次可见时再补上。
      if (document.hidden) return;
      void refreshInEffect();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, paused]);
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
