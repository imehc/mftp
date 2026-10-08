import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Monitor, Unplug } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { LanConnectedDevice } from "~/types";

import { lanPermissionLabel } from "./labels";

export default function LanConnectedDevices({
  devices,
  disconnectDevice,
}: {
  devices: LanConnectedDevice[];
  disconnectDevice: (id: string) => void;
}) {
  const { t } = useLingui();
  return (
    <section className="border-border bg-card rounded-lg border p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          <Trans>连接设备</Trans>
        </h2>
        <Badge variant="outline">
          <Plural
            value={{
              deviceCount: devices.length,
            }}
            one="# 设备"
            other="# 设备"
          />
        </Badge>
      </div>
      {devices.length === 0 ? (
        <div className="border-border text-muted-foreground flex min-h-20 items-center justify-center rounded-md border border-dashed text-xs">
          <Trans>暂无设备</Trans>
        </div>
      ) : (
        <div className="flex max-h-44 flex-col gap-1 overflow-auto">
          {devices.map((device) => (
            <div
              key={device.id}
              className="border-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Monitor className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="truncate text-sm font-medium">
                    {device.deviceName}
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-xs">
                  {device.ip} · {lanPermissionLabel(device.permission)}
                  {device.currentOperation ? " · " : ""}
                  {device.currentOperation}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                title={t`断开连接`}
                aria-label={t`断开连接`}
                className="max-md:min-h-11 max-md:min-w-11"
                onClick={() => void disconnectDevice(device.id)}
              >
                <Unplug className="text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
