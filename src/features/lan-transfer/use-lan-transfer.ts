import { useLingui } from "@lingui/react/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import { pickDirectoryNative } from "~/lib/files";
import * as ipc from "~/lib/ipc";
import { createPoller } from "~/lib/polling";
import { queryClient, queryScopeGuard } from "~/lib/query-client";
import { refreshQueries } from "~/lib/query-invalidation";
import { useQueryState } from "~/lib/use-query-state";
import type {
  AppError,
  LanSharedDirInput,
  LanTransferSettings,
  LanTransferStatus,
  LanTrustedDeviceInput,
} from "~/types";

import {
  loadLanTransferCore,
  loadLanTransferSecondary,
  scheduleIdleTask,
} from "./lanTransferData";
import { lanQueries, subscribeLanInvalidation } from "./queries";
import { useLanDiscovery } from "./useLanDiscovery";

let writing = false;

const DEFAULT_SETTINGS: LanTransferSettings = {
  deviceName: "",
  port: 3000,
  bindHost: "",
  downloadDir: "",
  autoStart: false,
  securityMode: "code",
  defaultPermission: "readWrite",
  maxConcurrentTransfers: 3,
};

export function useLanTransfer() {
  const { t } = useLingui();
  const [settings, setSettings] = useQueryState(lanQueries.settings, null);
  const [status, setStatus] = useState<LanTransferStatus | null>(null);
  const [shares, setShares] = useQueryState(lanQueries.shares, []);
  const [devices, setDevices] = useQueryState(lanQueries.devices, []);
  const [addresses] = useQueryState(lanQueries.addresses, []);
  const [tasks, setTasks] = useQueryState(lanQueries.tasks, []);
  const [trustedDevices, setTrustedDevices] = useQueryState(
    lanQueries.trusted,
    [],
  );
  const [authRequests, setAuthRequests] = useQueryState(lanQueries.auth, []);
  const mounted = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coreError, setCoreError] = useState<AppError | null>(null);
  const [secondaryError, setSecondaryError] = useState<AppError | null>(null);
  const [runtimeError, setRuntimeError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  // 读取代次在卸载和服务操作时失效，旧快照不能恢复已经停止的服务。
  const reads = useRef({ epoch: 0, core: 0, secondary: 0, runtime: 0 });
  const running = status?.running ?? false;
  const {
    discoveryError,
    discoveredDevices,
    discovering,
    refreshDiscovery,
    openDiscoveredDevice,
  } = useLanDiscovery(true);
  const bindHostUnavailable = Boolean(
    settings?.bindHost &&
    !addresses.some((address) => address.ip === settings.bindHost),
  );

  // 仅挂载时的预热；refreshCore/refreshSecondary 每次渲染都会重新定义，
  // 因此通过 effect event 读取，而不是进入依赖数组。
  async function refresh() {
    if (writing) return;
    await Promise.all([refreshCore(), refreshSecondary()]);
  }

  async function refreshCore() {
    if (writing) return;
    const epoch = reads.current.epoch;
    const request = ++reads.current.core;
    const current = () =>
      epoch === reads.current.epoch && request === reads.current.core;
    setLoading(true);
    try {
      const next = await loadLanTransferCore();
      if (!current()) return;
      setCoreError(null);
      setStatus(next.status);
    } catch (error) {
      if (current()) setCoreError(toIpcError(error).payload);
    } finally {
      if (current()) setLoading(false);
    }
  }

  async function refreshSecondary() {
    if (writing) return;
    const epoch = reads.current.epoch;
    const request = ++reads.current.secondary;
    const current = () =>
      epoch === reads.current.epoch && request === reads.current.secondary;
    try {
      await loadLanTransferSecondary();
      if (!current()) return;
      setSecondaryError(null);
    } catch (error) {
      if (current()) setSecondaryError(toIpcError(error).payload);
    }
  }

  async function refreshRuntime() {
    if (writing) return;
    const epoch = reads.current.epoch;
    const request = ++reads.current.runtime;
    const current = () =>
      epoch === reads.current.epoch && request === reads.current.runtime;
    try {
      const [nextStatus] = await Promise.all([
        ipc.lanTransferStatus(),
        lanQueries.devices.fetch(true),
        lanQueries.addresses.fetch(true),
        lanQueries.tasks.fetch(true),
        lanQueries.auth.fetch(true),
      ]);
      if (!current()) return;
      setRuntimeError(null);
      setStatus(nextStatus);
    } catch (error) {
      if (current()) setRuntimeError(toIpcError(error).payload);
    }
  }

  const refreshOnInvalidation = useEffectEvent(refresh);
  useEffect(
    () =>
      subscribeLanInvalidation(() => {
        void refreshOnInvalidation();
      }),
    [],
  );
  const refreshCoreOnMount = useEffectEvent(refreshCore);
  const refreshSecondaryOnMount = useEffectEvent(refreshSecondary);
  useEffect(() => {
    mounted.current = true;
    const readState = reads.current;
    void refreshCoreOnMount();
    const cancel = scheduleIdleTask(() => void refreshSecondaryOnMount());
    return () => {
      mounted.current = false;
      readState.epoch++;
      cancel();
    };
  }, []);
  const refreshRuntimeInEffect = useEffectEvent(refreshRuntime);
  useEffect(() => {
    if (!running) return;
    // 串行轮询：慢链路下不堆叠请求，页面不可见时暂停。
    const poller = createPoller(refreshRuntimeInEffect, {
      intervalMs: 5000,
      pauseWhenHidden: true,
    });
    return () => poller.stop();
  }, [running]);

  async function write<T>(
    action: () => Promise<T>,
    apply: (value: T) => void,
    notice: string,
  ) {
    if (writing || !mounted.current) return;
    const current = queryScopeGuard(queryClient, "lan");
    writing = true;
    const epoch = ++reads.current.epoch;
    Object.values(lanQueries).forEach((query) => query.cancel());
    setLoading(false);
    setBusy(true);
    try {
      const value = await action();
      if (!mounted.current || epoch !== reads.current.epoch || !current())
        return;
      apply(value);
      toast.success(notice);
    } catch (error) {
      if (mounted.current && epoch === reads.current.epoch)
        toast.error(describeError(error, t));
      return;
    } finally {
      writing = false;
      if (mounted.current) setBusy(false);
      // 写入结束时通知当前观察者；离开后重新打开的页面也能恢复读取。
      // 刷新失败留在读取状态，不改变已经完成的写入结果。
      if (current()) void refreshQueries(queryClient, { queryKey: ["lan"] });
    }
  }

  const start = () =>
    write(
      ipc.lanTransferStart,
      (next) => {
        setStatus(next);
        void refreshDiscovery();
      },
      t`服务已启动`,
    );

  const stop = () =>
    write(
      ipc.lanTransferStop,
      (next) => {
        setStatus(next);
        setDevices([]);
        setTasks([]);
        setAuthRequests([]);
      },
      t`服务已停止`,
    );

  const saveSettings = (values: LanTransferSettings) =>
    write(
      () => ipc.lanTransferSaveSettings(values),
      (next) => {
        setSettings(next);
        setSettingsOpen(false);
      },
      t`已保存配置`,
    );

  async function switchBindAuto() {
    if (!settings) return;
    await write(
      () => ipc.lanTransferSaveSettings({ ...settings, bindHost: "" }),
      setSettings,
      running ? t`已改为自动绑定，重启服务后生效` : t`已改为自动绑定`,
    );
  }

  const addShare = (input: LanSharedDirInput) =>
    write(
      () => ipc.lanTransferAddSharedDir(input),
      (dir) => {
        setShares((items) => [...items, dir]);
        setShareOpen(false);
      },
      t`已添加共享目录`,
    );

  const addTrustedDevice = (input: LanTrustedDeviceInput) =>
    write(
      () => ipc.lanTransferAddTrustedDevice(input),
      (device) => {
        setTrustedDevices((items) => [...items, device]);
      },
      t`已添加白名单`,
    );

  const deleteTrustedDevice = (id: string) =>
    write(
      () => ipc.lanTransferDeleteTrustedDevice(id),
      () => {
        setTrustedDevices((items) => items.filter((item) => item.id !== id));
      },
      t`已删除白名单`,
    );

  const deleteShare = (id: string) =>
    write(
      () => ipc.lanTransferDeleteSharedDir(id),
      () => {
        setShares((items) => items.filter((item) => item.id !== id));
      },
      t`已删除共享目录`,
    );

  const disconnectDevice = (id: string) =>
    write(
      () => ipc.lanTransferDisconnectDevice(id),
      () => {},
      t`已断开设备`,
    );
  const cancelTask = (id: string) =>
    write(
      () => ipc.lanTransferCancelTask(id),
      () => {},
      t`已取消任务`,
    );

  async function refreshAuthRequests() {
    if (writing) return;
    await refreshSecondary();
  }

  const approveAuthRequest = (id: string, permission: string) =>
    write(
      () => ipc.lanTransferApproveAuthRequest(id, permission),
      () => {},
      t`已允许访问`,
    );
  const rejectAuthRequest = (id: string) =>
    write(
      () => ipc.lanTransferRejectAuthRequest(id),
      () => {},
      t`已拒绝访问`,
    );

  async function chooseDownloadDir() {
    if (running) return null;
    try {
      return await pickDirectoryNative(t`选择接收目录`);
    } catch (error) {
      toast.error(describeError(error, t));
      return null;
    }
  }

  function openSettings() {
    setSettingsOpen(true);
  }

  return {
    loading,
    coreError,
    secondaryError,
    runtimeError,
    settings: settings ?? DEFAULT_SETTINGS,
    status,
    shares,
    devices,
    addresses,
    tasks,
    trustedDevices,
    authRequests,
    settingsOpen,
    setSettingsOpen,
    shareOpen,
    setShareOpen,
    busy,
    running,
    bindHostUnavailable,
    discoveryError,
    discoveredDevices,
    discovering,
    refreshDiscovery,
    openDiscoveredDevice,
    refresh,
    start,
    stop,
    saveSettings,
    switchBindAuto,
    addShare,
    addTrustedDevice,
    deleteTrustedDevice,
    deleteShare,
    disconnectDevice,
    cancelTask,
    refreshAuthRequests,
    approveAuthRequest,
    rejectAuthRequest,
    chooseDownloadDir,
    openSettings,
  };
}
