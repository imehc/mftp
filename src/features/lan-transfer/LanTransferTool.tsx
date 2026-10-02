import { Trans, useLingui } from "@lingui/react/macro";
import {
  LoaderCircle,
  Power,
  RefreshCw,
  Settings,
  ShieldAlert,
} from "lucide-react";
import AppPageLayout from "~/components/AppPageLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import LanDiscoveredDevicesPanel from "./LanDiscoveredDevicesPanel";
import LanPendingAuthRequestsPanel from "./LanPendingAuthRequestsPanel";
import LanShareDialog from "./LanShareDialog";
import LanSharedDirsSection from "./LanSharedDirsSection";
import LanTransferSettingsDialog from "./LanTransferSettingsDialog";
import LanServiceCard from "./LanServiceCard";
import LanConnectedDevices from "./LanConnectedDevices";
import LanTransferActivity from "./LanTransferActivity";
import { describeError } from "~/lib/errors";
import { useLanTransfer } from "./use-lan-transfer";

export default function LanTransferTool() {
  const { t } = useLingui();
  const lan = useLanTransfer();
  const bindHost = lan.settings.bindHost;
  return (
    <AppPageLayout
      adaptiveDensity
      bottomInset="scroll"
      title={
        <span className="inline-flex items-center gap-2">
          <Trans>局域网传输</Trans>
          <Badge variant={lan.running ? "secondary" : "outline"}>
            {lan.loading
              ? t`加载中`
              : lan.coreError
                ? t`状态不可用`
                : lan.running
                  ? t`运行中`
                  : t`已停止`}
          </Badge>
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            density="adaptive"
            variant="outline"
            size="sm"
            disabled={lan.busy || lan.loading || !!lan.coreError}
            onClick={lan.running ? lan.stop : lan.start}
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
      contentClassName="flex flex-col gap-3"
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
    </AppPageLayout>
  );
}
