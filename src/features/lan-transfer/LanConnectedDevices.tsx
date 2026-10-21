import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Monitor, Unplug } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import type { LanConnectedDevice } from "~/types";

import { lanPermissionLabel } from "./labels";
import LanConfirmDialog from "./LanConfirmDialog";

export default function LanConnectedDevices({
  devices,
  disconnectDevice,
}: {
  devices: LanConnectedDevice[];
  disconnectDevice: (id: string) => void;
}) {
  const { t } = useLingui();
  const [pending, setPending] = useState<LanConnectedDevice | null>(null);
  const pendingName = pending?.deviceName ?? "";
  return (
    <>
      <section className="border-border bg-card rounded-xl border p-3">
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
          <Empty className="min-h-20 gap-0 border border-dashed p-3">
            <EmptyHeader>
              <EmptyTitle className="text-muted-foreground text-xs font-normal">
                <Trans>暂无设备</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
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
                  className={TOUCH_TARGET_CLASS}
                  onClick={() => setPending(device)}
                >
                  <Unplug className="text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      <LanConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t`断开连接`}
        description={
          <>
            {t`断开与“${pendingName}”的连接？`}
            <span className="mt-2 block">
              <Trans>该设备需要重新连接才能继续访问。</Trans>
            </span>
            {pending?.currentOperation ? (
              <span className="mt-2 block">
                <Trans>正在进行的操作会被中断。</Trans>
              </span>
            ) : null}
          </>
        }
        confirmLabel={t`断开连接`}
        onConfirm={() => {
          if (pending) void disconnectDevice(pending.id);
        }}
      />
    </>
  );
}
