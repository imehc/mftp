import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLink, MonitorSmartphone, RefreshCw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { describeError } from "~/lib/errors";
import { formatRelativeTime } from "~/lib/relative-time";
import type { AppError, LanDiscoveredDevice } from "~/types";

interface Props {
  error: AppError | null;
  devices: LanDiscoveredDevice[];
  discovering: boolean;
  refresh: () => void;
  openDevice: (device: LanDiscoveredDevice) => void;
}

export default function LanDiscoveredDevicesPanel({
  error,
  devices,
  discovering,
  refresh,
  openDevice,
}: Props) {
  const { t } = useLingui();
  return (
    <section className="border-border bg-card flex flex-col rounded-xl border">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            <Trans>附近设备</Trans>
          </h2>
          <p className="app-description truncate">
            <Trans comment="附近设备面板副标题，仅同网段的 MFTP 客户端会被发现">
              同网段设备
            </Trans>
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          density="adaptive"
          title={t`刷新`}
          aria-label={t`刷新`}
          onClick={refresh}
          disabled={discovering}
        >
          <RefreshCw
            className={discovering ? "animate-spin" : undefined}
            aria-hidden
          />
        </Button>
      </div>
      <div className="p-2">
        {error ? (
          <p
            role="alert"
            className="text-destructive px-2 py-3 text-xs wrap-anywhere"
          >
            {describeError(error, t)}
          </p>
        ) : null}
        {devices.length === 0 && !error ? (
          <Empty className="min-h-16 gap-0 border border-dashed p-3">
            <EmptyHeader>
              <EmptyTitle className="text-muted-foreground text-xs font-normal">
                <Trans>暂无发现设备</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-1.5">
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
                  {!device.online ? (
                    <div className="app-description mt-0.5">
                      <Trans>离线，无法打开</Trans>
                    </div>
                  ) : null}
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
