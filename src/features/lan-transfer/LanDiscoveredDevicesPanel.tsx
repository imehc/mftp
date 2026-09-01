import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLink, MonitorSmartphone, RefreshCw } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { LanDiscoveredDevice } from "~/types";
import { formatRelativeTime } from "~/lib/relative-time";
interface Props {
  devices: LanDiscoveredDevice[];
  discovering: boolean;
  refresh: () => void;
  openDevice: (device: LanDiscoveredDevice) => void;
}
export default function LanDiscoveredDevicesPanel({
  devices,
  discovering,
  refresh,
  openDevice,
}: Props) {
  const { t } = useLingui();
  return (
    <section className="border-border bg-card flex flex-col rounded-lg border">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            <Trans>发现设备</Trans>
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            <Trans>同网段 MFTP 客户端，点击可直接打开访问地址</Trans>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={discovering}
        >
          <RefreshCw
            className={discovering ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          <Trans>刷新</Trans>
        </Button>
      </div>
      <div className="p-2">
        {devices.length === 0 ? (
          <div className="border-border text-muted-foreground flex min-h-24 items-center justify-center rounded-md border border-dashed text-xs">
            <Trans>暂无发现设备</Trans>
          </div>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {devices.map((device) => (
              <button
                key={device.id}
                type="button"
                className="border-border hover:bg-muted/60 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!device.online}
                onClick={() => openDevice(device)}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <MonitorSmartphone className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate text-sm font-medium">
                      {device.deviceName}
                    </span>
                    <Badge variant={device.online ? "secondary" : "outline"}>
                      {device.online ? t`在线` : t`离线`}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 truncate text-xs">
                    {device.ip}:{device.port} ·{" "}
                    {formatRelativeTime(device.lastSeen, {
                      justNowThresholdMs: 10_000,
                    })}
                  </div>
                </div>
                <ExternalLink className="text-muted-foreground size-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
