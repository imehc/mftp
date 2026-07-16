import { startTransition, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  FolderOpen,
  Home,
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import LanDiscoveredDevicesPanel from "~/features/lan-transfer/LanDiscoveredDevicesPanel";
import LanPendingAuthRequestsPanel from "~/features/lan-transfer/LanPendingAuthRequestsPanel";
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
  LanTransferSettings,
  LanTransferStatus,
  LanTransferTask,
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
  const [draftSettings, setDraftSettings] =
    useState<LanTransferSettings>(DEFAULT_SETTINGS);
  const [shareName, setShareName] = useState("");
  const [sharePath, setSharePath] = useState("");
  const [trustedLabel, setTrustedLabel] = useState("");
  const [trustedIp, setTrustedIp] = useState("");
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
  const draftBindHostUnavailable = Boolean(
    draftSettings.bindHost &&
      !addresses.some((address) => address.ip === draftSettings.bindHost),
  );

  useEffect(() => {
    void refreshCore();
    return scheduleIdleTask(() => void refreshSecondary());
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void refreshRuntime();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function refresh() {
    await Promise.all([refreshCore(), refreshSecondary()]);
  }

  async function refreshCore() {
    try {
      const next = await loadLanTransferCore();
      setSettings(next.settings);
      setDraftSettings(next.settings);
      setStatus(next.status);
      setShares(next.shares);
      setAddresses(next.addresses);
    } catch (error) {
      toast.error(`局域网传输加载失败：${String(error)}`);
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
      // Secondary panels can retry through their own refresh controls.
      toast.error(`局域网传输辅助数据加载失败：${String(error)}`);
    }
  }

  async function refreshRuntime() {
    try {
      const [nextStatus, nextDevices, nextAddresses, nextTasks, nextAuthRequests] =
        await Promise.all([
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
      // Runtime polling should not interrupt the current workflow.
    }
  }

  async function start() {
    setBusy(true);
    try {
      const next = await ipc.lanTransferStart();
    setStatus(next);
    setDevices(await ipc.lanTransferConnectedDevices());
    void refreshDiscovery();
    toast.success("服务已启动");
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
      toast.success("服务已停止");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const next = await ipc.lanTransferSaveSettings({
        ...draftSettings,
        maxConcurrentTransfers: Math.min(
          16,
          Math.max(1, Math.floor(Number(draftSettings.maxConcurrentTransfers) || 3)),
        ),
      });
      setSettings(next);
      setDraftSettings(next);
      setSettingsOpen(false);
      toast.success("已保存配置");
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
      setDraftSettings(next);
      toast.success(running ? "已改为自动绑定，重启服务后生效" : "已改为自动绑定");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addShare() {
    if (!shareName.trim() || !sharePath.trim()) {
      toast.error("请选择共享目录并填写名称");
      return;
    }
    setBusy(true);
    try {
      const dir = await ipc.lanTransferAddSharedDir({
        name: shareName.trim(),
        path: sharePath.trim(),
      });
      setShares((items) => [...items, dir]);
      setShareName("");
      setSharePath("");
      setShareOpen(false);
      toast.success("已添加共享目录");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addTrustedDevice() {
    if (!trustedIp.trim()) {
      toast.error("请输入 IP 地址");
      return;
    }
    try {
      const device = await ipc.lanTransferAddTrustedDevice({
        label: trustedLabel.trim() || trustedIp.trim(),
        ip: trustedIp.trim(),
      });
      setTrustedDevices((items) => [...items, device]);
      setTrustedLabel("");
      setTrustedIp("");
      toast.success("已添加白名单");
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function deleteTrustedDevice(id: string) {
    try {
      await ipc.lanTransferDeleteTrustedDevice(id);
      setTrustedDevices((items) => items.filter((item) => item.id !== id));
      toast.success("已删除白名单");
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function deleteShare(id: string) {
    try {
      await ipc.lanTransferDeleteSharedDir(id);
      setShares((items) => items.filter((item) => item.id !== id));
      toast.success("已删除共享目录");
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
      toast.success("已断开设备");
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function cancelTask(id: string) {
    try {
      await ipc.lanTransferCancelTask(id);
      setTasks(await ipc.lanTransferTasks());
      toast.success("已取消任务");
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
      toast.success("已允许访问");
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function rejectAuthRequest(id: string) {
    try {
      await ipc.lanTransferRejectAuthRequest(id);
      await refreshAuthRequests();
      toast.success("已拒绝访问");
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function copyUrl() {
    if (!status?.url) return;
    await navigator.clipboard.writeText(status.url);
    toast.success("已复制地址");
  }

  async function chooseDownloadDir() {
    if (running) return;
    const selected = await open({
      multiple: false,
      directory: true,
      title: "选择接收目录",
    });
    if (typeof selected === "string") {
      setDraftSettings((current) => ({ ...current, downloadDir: selected }));
    }
  }

  async function chooseShareDir() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "选择共享目录",
    });
    if (typeof selected !== "string") return;
    setSharePath(selected);
    if (!shareName.trim()) {
      const parts = selected.split(/[\\/]/).filter(Boolean);
      setShareName(parts[parts.length - 1] ?? "共享目录");
    }
  }

  function openSettings() {
    setDraftSettings(settings ?? DEFAULT_SETTINGS);
    setSettingsOpen(true);
  }

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              首页
            </Link>
          </Button>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
            局域网传输
          </div>
        </div>
        <Badge variant={running ? "secondary" : "outline"}>
          {running ? "运行中" : "已停止"}
        </Badge>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2 overflow-auto p-2.5 sm:p-3">
        <section className="rounded-lg border border-border bg-card p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Wifi />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h1 className="truncate text-sm font-semibold">
                    {settings?.deviceName || "局域网传输"}
                  </h1>
                  {status?.confirmationCode ? (
                    <Badge variant="outline">确认码 {status.confirmationCode}</Badge>
                  ) : null}
                  <Badge variant="outline">{status?.onlineConnections ?? 0} 在线</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {status?.url ?? "启动服务后显示浏览器访问地址"}
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
                复制
              </Button>
              <Button variant="outline" size="sm" onClick={openSettings}>
                <Settings data-icon="inline-start" />
                设置
              </Button>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw data-icon="inline-start" />
                刷新
              </Button>
              <Button size="sm" onClick={running ? stop : start} disabled={busy}>
                {busy ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Power data-icon="inline-start" />
                )}
                {running ? "停止" : "启动"}
              </Button>
            </div>
          </div>
        </section>

        {bindHostUnavailable ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>绑定 IP 不可用</AlertTitle>
            <AlertDescription>
              当前配置的 {settings?.bindHost} 不在可用网卡列表中，访问地址可能失效。
            </AlertDescription>
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={switchBindAuto}
                disabled={busy}
              >
                改为自动选择
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
        draftSettings={draftSettings}
        setDraftSettings={setDraftSettings}
        addresses={addresses}
        draftBindHostUnavailable={draftBindHostUnavailable}
        trustedDevices={trustedDevices}
        trustedLabel={trustedLabel}
        setTrustedLabel={setTrustedLabel}
        trustedIp={trustedIp}
        setTrustedIp={setTrustedIp}
        running={running}
        busy={busy}
        chooseDownloadDir={chooseDownloadDir}
        addTrustedDevice={addTrustedDevice}
        deleteTrustedDevice={deleteTrustedDevice}
        saveSettings={saveSettings}
      />


      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加共享目录</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="lan-share-name">名称</FieldLabel>
              <Input
                id="lan-share-name"
                value={shareName}
                onChange={(event) => setShareName(event.target.value)}
                placeholder="共享目录"
              />
            </Field>
            <Field>
              <FieldLabel>本地目录</FieldLabel>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={sharePath}
                  placeholder="未选择"
                  className="flex-1"
                />
                <Button variant="outline" onClick={chooseShareDir}>
                  <FolderOpen data-icon="inline-start" />
                  选择
                </Button>
              </div>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              取消
            </Button>
            <Button onClick={addShare} disabled={busy}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
