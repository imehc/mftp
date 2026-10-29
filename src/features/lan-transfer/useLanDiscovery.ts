import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { scheduleIdleTask } from "~/features/lan-transfer/lanTransferData";
import { describeError, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { createPoller } from "~/lib/polling";
import { createQueryResource, type QueryResource } from "~/lib/query-resource";
import { useQueryState } from "~/lib/use-query-state";
import type { AppError, LanDiscoveredDevice } from "~/types";

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

const discovery: QueryResource<LanDiscoveredDevice[]> = createQueryResource(
  ["lan", "discovery"],
  async () =>
    mergeDevices(discovery.get() ?? [], await ipc.lanTransferDiscoverDevices()),
);

export function useLanDiscovery(active: boolean) {
  const [devices] = useQueryState(discovery, []);
  const request = useRef({ generation: 0, pending: false });
  const [discoveryError, setDiscoveryError] = useState<AppError | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const refreshDiscovery = async () => {
    if (request.current.pending || !active) return;
    request.current.pending = true;
    const generation = request.current.generation;
    setDiscovering(true);
    try {
      await discovery.fetch(true);
      if (generation !== request.current.generation) return;
      setDiscoveryError(null);
    } catch (error) {
      if (generation === request.current.generation)
        setDiscoveryError(toIpcError(error).payload);
    } finally {
      request.current.pending = false;
      if (generation === request.current.generation) setDiscovering(false);
    }
  };

  // 用最新的 refreshDiscovery 闭包轮询，且不在每次渲染时重置定时器；
  // refreshDiscovery 也作为手动刷新返回。
  const refreshDiscoveryInEffect = useEffectEvent(refreshDiscovery);
  useEffect(() => {
    if (!active) {
      return;
    }
    const requestState = request.current;
    const cancelInitial = scheduleIdleTask(() => {
      void refreshDiscoveryInEffect();
    });
    // 串行轮询：广播发现不堆叠请求，页面不可见时暂停。
    const poller = createPoller(refreshDiscoveryInEffect, {
      intervalMs: 15_000,
      runImmediately: false,
      pauseWhenHidden: true,
    });
    return () => {
      // 关闭后晚到的广播结果不再写回页面，解除轮询不等于取消原生请求。
      requestState.generation++;
      cancelInitial();
      poller.stop();
    };
  }, [active]);

  const openDiscoveredDevice = async (device: LanDiscoveredDevice) => {
    try {
      await openUrl(device.url);
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  return {
    discoveryError,
    discoveredDevices: mergeDevices(devices, []),
    discovering,
    refreshDiscovery,
    openDiscoveredDevice,
  };
}
