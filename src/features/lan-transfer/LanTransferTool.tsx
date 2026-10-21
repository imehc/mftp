import { Trans, useLingui } from "@lingui/react/macro";
import {
  LoaderCircle,
  Power,
  RefreshCw,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";

import AppPageLayout from "~/components/AppPageLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";

import LanConfirmDialog from "./LanConfirmDialog";
import LanConnectedDevices from "./LanConnectedDevices";
import LanDiscoveredDevicesPanel from "./LanDiscoveredDevicesPanel";
import LanPendingAuthRequestsPanel from "./LanPendingAuthRequestsPanel";
import LanServiceCard from "./LanServiceCard";
import LanSharedDirsSection from "./LanSharedDirsSection";
import LanShareDialog from "./LanShareDialog";
import LanTransferActivity from "./LanTransferActivity";
import LanTransferSettingsDialog from "./LanTransferSettingsDialog";
import { useLanTransfer } from "./use-lan-transfer";

export default function LanTransferTool() {
  const { t } = useLingui();
  const lan = useLanTransfer();
  const [stopOpen, setStopOpen] = useState(false);
  const bindHost = lan.settings.bindHost;
  return (
    <AppPageLayout
      adaptiveDensity
      bottomInset="scroll"
      title={<Trans>局域网传输</Trans>}
      actions={
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <Button
            density="adaptive"
            variant={lan.running ? "destructive" : "default"}
            size="sm"
            disabled={lan.busy || lan.loading || !!lan.coreError}
            onClick={lan.running ? () => setStopOpen(true) : lan.start}
          >
            {lan.busy ? <LoaderCircle className="animate-spin" /> : <Power />}
            {lan.running ? t`停止服务` : t`启动服务`}
          </Button>
          <Button
            density="adaptive"
            variant="ghost"
            size="icon-sm"
            disabled={lan.busy || lan.loading}
            onClick={lan.refresh}
            aria-label={t`刷新`}
          >
            <RefreshCw />
          </Button>
          <Button
            density="adaptive"
            variant="ghost"
            size="icon-sm"
            disabled={lan.loading || !!lan.coreError}
            onClick={lan.openSettings}
            aria-label={t`局域网传输设置`}
          >
            <Settings />
          </Button>
        </div>
      }
      contentDensity="compact"
    >
      {lan.coreError || lan.secondaryError || lan.runtimeError ? (
        <Alert variant="destructive">
          <AlertTitle>
            <Trans>读取失败</Trans>
          </AlertTitle>
          <AlertDescription>
            {describeError(
              lan.coreError ?? lan.secondaryError ?? lan.runtimeError,
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={lan.refresh}
              disabled={lan.busy || lan.loading}
            >
              <Trans>重试</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {lan.status ? (
        <>
          <LanServiceCard settings={lan.settings} status={lan.status} />
          {lan.bindHostUnavailable ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertTitle>
                <Trans>绑定 IP 不可用</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  当前配置的 {bindHost} 不在可用网卡列表中，访问地址可能失效。
                </Trans>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={lan.switchBindAuto}
                  disabled={lan.busy || lan.loading || !!lan.coreError}
                >
                  <Trans>改为自动选择</Trans>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid items-start gap-3 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <LanSharedDirsSection
                shares={lan.shares}
                running={lan.running}
                openShare={() => lan.setShareOpen(true)}
                deleteShare={lan.deleteShare}
              />
              <LanConnectedDevices
                devices={lan.devices}
                disconnectDevice={lan.disconnectDevice}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <LanDiscoveredDevicesPanel
                error={lan.discoveryError}
                devices={lan.discoveredDevices}
                discovering={lan.discovering}
                refresh={lan.refreshDiscovery}
                openDevice={lan.openDiscoveredDevice}
              />
              {lan.authRequests.length > 0 ? (
                <LanPendingAuthRequestsPanel
                  requests={lan.authRequests}
                  refreshing={lan.busy}
                  refresh={lan.refreshAuthRequests}
                  approve={lan.approveAuthRequest}
                  reject={lan.rejectAuthRequest}
                />
              ) : null}
            </div>
          </div>
          <LanTransferActivity tasks={lan.tasks} cancelTask={lan.cancelTask} />
        </>
      ) : lan.loading ? (
        <p
          role="status"
          className="text-muted-foreground py-6 text-center text-sm"
        >
          <Trans>加载中</Trans>
        </p>
      ) : null}
      <LanTransferSettingsDialog
        open={lan.settingsOpen}
        onOpenChange={lan.setSettingsOpen}
        settings={lan.settings}
        addresses={lan.addresses}
        trustedDevices={lan.trustedDevices}
        running={lan.running}
        busy={lan.busy}
        chooseDownloadDir={lan.chooseDownloadDir}
        addTrustedDevice={lan.addTrustedDevice}
        deleteTrustedDevice={lan.deleteTrustedDevice}
        saveSettings={lan.saveSettings}
      />
      <LanShareDialog
        open={lan.shareOpen}
        busy={lan.busy}
        onOpenChange={lan.setShareOpen}
        onAdd={lan.addShare}
      />
      <LanConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title={t`停止服务`}
        description={
          <Trans>停止后，进行中的传输会被中断，已连接设备会断开。</Trans>
        }
        confirmLabel={t`停止服务`}
        onConfirm={() => void lan.stop()}
      />
    </AppPageLayout>
  );
}
