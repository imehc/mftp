import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  LoaderCircle,
  Power,
  RefreshCw,
  Settings,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import LanDiscoveredDevicesPanel from "~/features/lan-transfer/LanDiscoveredDevicesPanel";
import LanPendingAuthRequestsPanel from "~/features/lan-transfer/LanPendingAuthRequestsPanel";
import LanShareDialog from "~/features/lan-transfer/LanShareDialog";
import LanSharedDirsSection from "~/features/lan-transfer/LanSharedDirsSection";
import LanTransferSidebar from "~/features/lan-transfer/LanTransferSidebar";
import LanTransferSettingsDialog from "~/features/lan-transfer/LanTransferSettingsDialog";
import {
  loadLanTransferCore,
  loadLanTransferSecondary,
  scheduleIdleTask,
} from "~/features/lan-transfer/lanTransferData";
import { useLanDiscovery } from "~/features/lan-transfer/useLanDiscovery";
import * as ipc from "~/lib/ipc";
import type {
  LanConnectedDevice,
  LanNetworkAddress,
  LanSharedDir,
  LanSharedDirInput,
  LanTransferSettings,
  LanTransferStatus,
  LanTransferTask,
  LanTrustedDeviceInput,
  LanTrustedDevice,
  LanAuthRequest,
} from "~/types";
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
export default function LanTransferTool() {
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
  const running = status?.running ?? false;
  const {
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
    try {
      const next = await loadLanTransferCore();
      setSettings(next.settings);
      setStatus(next.status);
      setShares(next.shares);
      setAddresses(next.addresses);
    } catch (error) {
      const StringValue = String(error);
      toast.error(t`局域网传输加载失败：${StringValue}`);
    }
  }
  async function refreshSecondary() {
    try {
      const next = await loadLanTransferSecondary();
      startTransition(() => {
        setDevices(next.devices);
        setTasks(next.tasks);
        setTrustedDevices(next.trustedDevices);
        setAuthRequests(next.authRequests);
      });
    } catch (error) {
      const StringValue2 = String(error);
      // 辅助面板可各自通过刷新控件重试。
      toast.error(t`局域网传输辅助数据加载失败：${StringValue2}`);
    }
  }
  async function refreshRuntime() {
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
      setStatus(nextStatus);
      setDevices(nextDevices);
      setAddresses(nextAddresses);
      setTasks(nextTasks);
      setAuthRequests(nextAuthRequests);
    } catch {
      // 运行时轮询不应打断当前的工作流。
    }
  }
  const refreshCoreOnMount = useEffectEvent(refreshCore);
  const refreshSecondaryOnMount = useEffectEvent(refreshSecondary);
  useEffect(() => {
    void refreshCoreOnMount();
    return scheduleIdleTask(() => void refreshSecondaryOnMount());
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void refreshRuntime();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [running]);
  async function start() {
    setBusy(true);
    try {
      const next = await ipc.lanTransferStart();
      setStatus(next);
      setDevices(await ipc.lanTransferConnectedDevices());
      void refreshDiscovery();
      toast.success(t`服务已启动`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      const next = await ipc.lanTransferStop();
      setStatus(next);
      setDevices([]);
      setTasks([]);
      setAuthRequests([]);
      toast.success(t`服务已停止`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings(values: LanTransferSettings) {
    setBusy(true);
    try {
      const next = await ipc.lanTransferSaveSettings(values);
      setSettings(next);
      setSettingsOpen(false);
      toast.success(t`已保存配置`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function switchBindAuto() {
    if (!settings) return;
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
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function addShare(input: LanSharedDirInput) {
    setBusy(true);
    try {
      const dir = await ipc.lanTransferAddSharedDir(input);
      setShares((items) => [...items, dir]);
      setShareOpen(false);
      toast.success(t`已添加共享目录`);
    } catch (error) {
      toast.error(String(error));
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
      toast.error(String(error));
    }
  }
  async function deleteTrustedDevice(id: string) {
    try {
      await ipc.lanTransferDeleteTrustedDevice(id);
      setTrustedDevices((items) => items.filter((item) => item.id !== id));
      toast.success(t`已删除白名单`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function deleteShare(id: string) {
    try {
      await ipc.lanTransferDeleteSharedDir(id);
      setShares((items) => items.filter((item) => item.id !== id));
      toast.success(t`已删除共享目录`);
    } catch (error) {
      toast.error(String(error));
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
      toast.error(String(error));
    }
  }
  async function cancelTask(id: string) {
    try {
      await ipc.lanTransferCancelTask(id);
      setTasks(await ipc.lanTransferTasks());
      toast.success(t`已取消任务`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function refreshAuthRequests() {
    try {
      setAuthRequests(await ipc.lanTransferPendingAuthRequests());
    } catch (error) {
      toast.error(String(error));
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
      toast.error(String(error));
    }
  }
  async function rejectAuthRequest(id: string) {
    try {
      await ipc.lanTransferRejectAuthRequest(id);
      await refreshAuthRequests();
      toast.success(t`已拒绝访问`);
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function copyUrl() {
    if (!status?.url) return;
    await navigator.clipboard.writeText(status.url);
    toast.success(t`已复制地址`);
  }
  async function chooseDownloadDir() {
    if (running) return null;
    const selected = await open({
      multiple: false,
      directory: true,
      title: t`选择接收目录`,
    });
    return typeof selected === "string" ? selected : null;
  }
  function openSettings() {
    setSettingsOpen(true);
  }
  const statusConfirmationCode = status?.confirmationCode;
  const value = settings?.bindHost;
  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>局域网传输</Trans>}
        trailing={
          <Badge variant={running ? "secondary" : "outline"}>
            {running ? t`运行中` : t`已停止`}
          </Badge>
        }
      />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2 overflow-auto p-2.5 sm:p-3">
        <section className="border-border bg-card rounded-lg border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border">
                <Wifi />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h1 className="truncate text-sm font-semibold">
                    {settings?.deviceName || t`局域网传输`}
                  </h1>
                  {status?.confirmationCode ? (
                    <Badge variant="outline">
                      <Trans>确认码 {statusConfirmationCode}</Trans>
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    <Plural
                      value={{
                        onlineConnectionCount: status?.onlineConnections ?? 0,
                      }}
                      one="# 个在线连接"
                      other="# 个在线连接"
                    />
                  </Badge>
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {status?.url ?? t`启动服务后显示浏览器访问地址`}
                </p>
              </div>
            </div>
            <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={copyUrl}
                disabled={!status?.url}
              >
                <Copy data-icon="inline-start" />
                <Trans>复制</Trans>
              </Button>
              <Button variant="outline" size="sm" onClick={openSettings}>
                <Settings data-icon="inline-start" />
                <Trans>设置</Trans>
              </Button>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw data-icon="inline-start" />
                <Trans>刷新</Trans>
              </Button>
              <Button
                size="sm"
                onClick={running ? stop : start}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Power data-icon="inline-start" />
                )}
                {running ? t`停止` : t`启动`}
              </Button>
            </div>
          </div>
        </section>

        {bindHostUnavailable ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>
              <Trans>绑定 IP 不可用</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                当前配置的 {value} 不在可用网卡列表中，访问地址可能失效。
              </Trans>
            </AlertDescription>
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={switchBindAuto}
                disabled={busy}
              >
                <Trans>改为自动选择</Trans>
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] xl:items-start">
          <LanSharedDirsSection
            shares={shares}
            running={running}
            openShare={() => setShareOpen(true)}
            deleteShare={deleteShare}
          />

          <LanPendingAuthRequestsPanel
            requests={authRequests}
            refreshing={busy}
            refresh={() => void refreshAuthRequests()}
            approve={approveAuthRequest}
            reject={rejectAuthRequest}
          />

          <div className="grid gap-2">
            <LanDiscoveredDevicesPanel
              devices={discoveredDevices}
              discovering={discovering}
              refresh={() => void refreshDiscovery()}
              openDevice={(device) => {
                void openDiscoveredDevice(device);
              }}
            />
            <LanTransferSidebar
              settings={settings}
              status={status}
              devices={devices}
              tasks={tasks}
              disconnectDevice={disconnectDevice}
              cancelTask={cancelTask}
            />
          </div>
        </div>
      </div>

      <LanTransferSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings ?? DEFAULT_SETTINGS}
        addresses={addresses}
        trustedDevices={trustedDevices}
        running={running}
        busy={busy}
        chooseDownloadDir={chooseDownloadDir}
        addTrustedDevice={addTrustedDevice}
        deleteTrustedDevice={deleteTrustedDevice}
        saveSettings={saveSettings}
      />

      <LanShareDialog
        open={shareOpen}
        busy={busy}
        onOpenChange={setShareOpen}
        onAdd={addShare}
      />
    </main>
  );
}
