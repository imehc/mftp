import { startTransition, useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { scheduleIdleTask } from "~/features/lan-transfer/lanTransferData";
import * as ipc from "~/lib/ipc";
import type { LanDiscoveredDevice } from "~/types";

const OFFLINE_AFTER_MS = 30_000;
const REMOVE_AFTER_MS = 5 * 60_000;

function mergeDevices(
  current: LanDiscoveredDevice[],
  next: LanDiscoveredDevice[],
) {
  const now = Date.now();
  const byId = new Map(current.map((device) => [device.id, device]));
  for (const device of next) {
    byId.set(device.id, { ...device, online: true });
  }
  return Array.from(byId.values())
    .map((device) => ({
      ...device,
      online: device.online && now - device.lastSeen <= OFFLINE_AFTER_MS,
    }))
    .filter((device) => now - device.lastSeen <= REMOVE_AFTER_MS)
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.deviceName.localeCompare(b.deviceName) || a.ip.localeCompare(b.ip);
    });
}

export function useLanDiscovery(active: boolean) {
  const [devices, setDevices] = useState<LanDiscoveredDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const refreshDiscovery = useCallback(async () => {
    setDiscovering(true);
    try {
      const next = await ipc.lanTransferDiscoverDevices();
      startTransition(() => {
        setDevices((current) => mergeDevices(current, next));
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setDevices((current) => mergeDevices(current, []));
      return;
    }
    const cancelInitial = scheduleIdleTask(() => {
      void refreshDiscovery();
    });
    const timer = window.setInterval(() => {
      void refreshDiscovery();
    }, 15_000);
    return () => {
      cancelInitial();
      window.clearInterval(timer);
    };
  }, [active, refreshDiscovery]);

  const openDiscoveredDevice = useCallback(async (device: LanDiscoveredDevice) => {
    try {
      await openUrl(device.url);
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  return {
    discoveredDevices: devices,
    discovering,
    refreshDiscovery,
    openDiscoveredDevice,
  };
}
