import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLink, MonitorSmartphone, RefreshCw } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { LanDiscoveredDevice } from "~/types";
import { translate } from "~/i18n/translate";

interface Props {
  devices: LanDiscoveredDevice[];
  discovering: boolean;
  refresh: () => void;
  openDevice: (device: LanDiscoveredDevice) => void;
}

function formatSeen(value: number) {
  if (!value) return "-";
  const diff = Math.max(0, Date.now() - value);
  if (diff < 10_000) return translate(msg`刚刚`);
  if (diff < 60_000) return translate(msg`${Math.floor(diff / 1000)} 秒前`);
  if (diff < 3_600_000) return translate(msg`${Math.floor(diff / 60_000)} 分钟前`);
  return translate(msg`${Math.floor(diff / 3_600_000)} 小时前`);
}

export default function LanDiscoveredDevicesPanel({
  devices,
  discovering,
  refresh,
  openDevice,
}: Props) {
  const { t } = useLingui();
  return (
    <section className="flex flex-col rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            <Trans>发现设备</Trans>
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            <Trans>同网段 MFTP 客户端，点击可直接打开访问地址</Trans>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={discovering}>
          <RefreshCw
            className={discovering ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          <Trans>刷新</Trans>
        </Button>
      </div>
      <div className="p-2">
        {devices.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Trans>暂无发现设备</Trans>
          </div>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {devices.map((device) => (
              <button
                key={device.id}
                type="button"
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!device.online}
                onClick={() => openDevice(device)}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <MonitorSmartphone className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">
                      {device.deviceName}
                    </span>
                    <Badge variant={device.online ? "secondary" : "outline"}>
                      {device.online ? t`在线` : t`离线`}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {device.ip}:{device.port} · {formatSeen(device.lastSeen)}
                  </div>
                </div>
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
