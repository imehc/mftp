import { startTransition, useEffect, useEffectEvent, useState } from "react";
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
    byId.set(device.id, {
      ...device,
      online: true,
    });
  }
  return Array.from(byId.values())
    .map((device) => ({
      ...device,
      online: device.online && now - device.lastSeen <= OFFLINE_AFTER_MS,
    }))
    .filter((device) => now - device.lastSeen <= REMOVE_AFTER_MS)
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (
        a.deviceName.localeCompare(b.deviceName) || a.ip.localeCompare(b.ip)
      );
    });
}
export function useLanDiscovery(active: boolean) {
  const [devices, setDevices] = useState<LanDiscoveredDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const refreshDiscovery = async () => {
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
  };
  // 用最新的 refreshDiscovery 闭包轮询，且不在每次渲染时重置定时器；
  // refreshDiscovery 也作为手动刷新返回。
  const refreshDiscoveryInEffect = useEffectEvent(refreshDiscovery);
  useEffect(() => {
    if (!active) {
      // 用微任务延后，使 setState 发生在 effect 函数体之外。
      queueMicrotask(() => setDevices((current) => mergeDevices(current, [])));
      return;
    }
    const cancelInitial = scheduleIdleTask(() => {
      void refreshDiscoveryInEffect();
    });
    const timer = window.setInterval(() => {
      void refreshDiscoveryInEffect();
    }, 15_000);
    return () => {
      cancelInitial();
      window.clearInterval(timer);
    };
  }, [active]);
  const openDiscoveredDevice = async (device: LanDiscoveredDevice) => {
    try {
      await openUrl(device.url);
    } catch (error) {
      toast.error(String(error));
    }
  };
  return {
    discoveredDevices: devices,
    discovering,
    refreshDiscovery,
    openDiscoveredDevice,
  };
}
