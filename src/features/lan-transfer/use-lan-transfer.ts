import { useLingui } from "@lingui/react/macro";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import { pickDirectoryNative } from "~/lib/files";
import * as ipc from "~/lib/ipc";
import { createPoller } from "~/lib/polling";
import type {
  AppError,
  LanAuthRequest,
  LanConnectedDevice,
  LanNetworkAddress,
  LanSharedDir,
  LanSharedDirInput,
  LanTransferSettings,
  LanTransferStatus,
  LanTransferTask,
  LanTrustedDevice,
  LanTrustedDeviceInput,
} from "~/types";

import {
  loadLanTransferCore,
  loadLanTransferSecondary,
  scheduleIdleTask,
} from "./lanTransferData";
import { useLanDiscovery } from "./useLanDiscovery";

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
  const [settings, setSettings] = useState<LanTransferSettings | null>(null);
  const [status, setStatus] = useState<LanTransferStatus | null>(null);
  const [shares, setShares] = useState<LanSharedDir[]>([]);
  const [devices, setDevices] = useState<LanConnectedDevice[]>([]);
  const [addresses, setAddresses] = useState<LanNetworkAddress[]>([]);
  const [tasks, setTasks] = useState<LanTransferTask[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<LanTrustedDevice[]>([]);
  const [authRequests, setAuthRequests] = useState<LanAuthRequest[]>([]);
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
    await Promise.all([refreshCore(), refreshSecondary()]);
  }

  async function refreshCore() {
    const epoch = reads.current.epoch;
    const request = ++reads.current.core;
    const current = () =>
      epoch === reads.current.epoch && request === reads.current.core;
    setLoading(true);
    try {
      const next = await loadLanTransferCore();
      if (!current()) return;
      setCoreError(null);
      setSettings(next.settings);
      setStatus(next.status);
      setShares(next.shares);
      setAddresses(next.addresses);
    } catch (error) {
      if (current()) setCoreError(toIpcError(error).payload);
    } finally {
      if (current()) setLoading(false);
    }
  }

  async function refreshSecondary() {
    const epoch = reads.current.epoch;
    const request = ++reads.current.secondary;
    const current = () =>
      epoch === reads.current.epoch && request === reads.current.secondary;
    try {
      const next = await loadLanTransferSecondary();
      if (!current()) return;
      setSecondaryError(null);
      startTransition(() => {
        setDevices(next.devices);
        setTasks(next.tasks);
        setTrustedDevices(next.trustedDevices);
        setAuthRequests(next.authRequests);
      });
    } catch (error) {
      if (current()) setSecondaryError(toIpcError(error).payload);
    }
  }

  async function refreshRuntime() {
    if (busy) return;
    const epoch = reads.current.epoch;
    const request = ++reads.current.runtime;
    const current = () =>
      epoch === reads.current.epoch && request === reads.current.runtime;
    try {
      const [
        nextStatus,
        nextDevices,
        nextAddresses,
        nextTasks,
        nextAuthRequests,
      ] = await Promise.all([
        ipc.lanTransferStatus(),
        ipc.lanTransferConnectedDevices(),
        ipc.lanTransferNetworkAddresses(),
        ipc.lanTransferTasks(),
        ipc.lanTransferPendingAuthRequests(),
      ]);
      if (!current()) return;
      setRuntimeError(null);
      setStatus(nextStatus);
      setDevices(nextDevices);
      setAddresses(nextAddresses);
      setTasks(nextTasks);
      setAuthRequests(nextAuthRequests);
    } catch (error) {
      if (current()) setRuntimeError(toIpcError(error).payload);
    }
  }

  const refreshCoreOnMount = useEffectEvent(refreshCore);
  const refreshSecondaryOnMount = useEffectEvent(refreshSecondary);
  useEffect(() => {
    const readState = reads.current;
    void refreshCoreOnMount();
    const cancel = scheduleIdleTask(() => void refreshSecondaryOnMount());
    return () => {
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

  async function start() {
    reads.current.epoch++;
    setLoading(false);
    setBusy(true);
    try {
      const next = await ipc.lanTransferStart();
      setStatus(next);
      setDevices(await ipc.lanTransferConnectedDevices());
      void refreshDiscovery();
      toast.success(t`服务已启动`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    reads.current.epoch++;
    setLoading(false);
    setBusy(true);
    try {
      const next = await ipc.lanTransferStop();
      setStatus(next);
      setDevices([]);
      setTasks([]);
      setAuthRequests([]);
      toast.success(t`服务已停止`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(values: LanTransferSettings) {
    reads.current.epoch++;
    setLoading(false);
    setBusy(true);
    try {
      const next = await ipc.lanTransferSaveSettings(values);
      setSettings(next);
      setSettingsOpen(false);
      toast.success(t`已保存配置`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function switchBindAuto() {
    if (!settings) return;
    reads.current.epoch++;
    setLoading(false);
    setBusy(true);
    try {
      const next = await ipc.lanTransferSaveSettings({
        ...settings,
        bindHost: "",
      });
      setSettings(next);
      toast.success(
        running ? t`已改为自动绑定，重启服务后生效` : t`已改为自动绑定`,
      );
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function addShare(input: LanSharedDirInput) {
    reads.current.epoch++;
    setLoading(false);
    setBusy(true);
    try {
      const dir = await ipc.lanTransferAddSharedDir(input);
      setShares((items) => [...items, dir]);
      setShareOpen(false);
      toast.success(t`已添加共享目录`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function addTrustedDevice(input: LanTrustedDeviceInput) {
    try {
      const device = await ipc.lanTransferAddTrustedDevice(input);
      setTrustedDevices((items) => [...items, device]);
      toast.success(t`已添加白名单`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function deleteTrustedDevice(id: string) {
    try {
      await ipc.lanTransferDeleteTrustedDevice(id);
      setTrustedDevices((items) => items.filter((item) => item.id !== id));
      toast.success(t`已删除白名单`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function deleteShare(id: string) {
    try {
      await ipc.lanTransferDeleteSharedDir(id);
      setShares((items) => items.filter((item) => item.id !== id));
      toast.success(t`已删除共享目录`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function disconnectDevice(id: string) {
    try {
      await ipc.lanTransferDisconnectDevice(id);
      const [nextStatus, nextDevices] = await Promise.all([
        ipc.lanTransferStatus(),
        ipc.lanTransferConnectedDevices(),
      ]);
      setStatus(nextStatus);
      setDevices(nextDevices);
      toast.success(t`已断开设备`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function cancelTask(id: string) {
    try {
      await ipc.lanTransferCancelTask(id);
      setTasks(await ipc.lanTransferTasks());
      toast.success(t`已取消任务`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function refreshAuthRequests() {
    try {
      setAuthRequests(await ipc.lanTransferPendingAuthRequests());
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function approveAuthRequest(id: string, permission: string) {
    try {
      await ipc.lanTransferApproveAuthRequest(id, permission);
      await refreshAuthRequests();
      const [nextStatus, nextDevices] = await Promise.all([
        ipc.lanTransferStatus(),
        ipc.lanTransferConnectedDevices(),
      ]);
      setStatus(nextStatus);
      setDevices(nextDevices);
      toast.success(t`已允许访问`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function rejectAuthRequest(id: string) {
    try {
      await ipc.lanTransferRejectAuthRequest(id);
      await refreshAuthRequests();
      toast.success(t`已拒绝访问`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function chooseDownloadDir() {
    if (running) return null;
    try {
      return await pickDirectoryNative(t`选择接收目录`);
    } catch (error) {
      toast.error(describeError(error));
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
