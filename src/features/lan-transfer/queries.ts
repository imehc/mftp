import * as ipc from "~/lib/ipc";
import { queryClient } from "~/lib/query-client";
import { createQueryResource } from "~/lib/query-resource";
import type { LanTransferSettings } from "~/types";

const invalidationListeners = new Set<() => void>();
let scheduled = false;

export function subscribeLanInvalidation(refresh: () => void) {
  invalidationListeners.add(refresh);
  return () => {
    invalidationListeners.delete(refresh);
  };
}

function resource<T>(name: string, read: () => Promise<T>) {
  return createQueryResource(["lan", name], read, queryClient, () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      invalidationListeners.forEach((refresh) => refresh());
    });
  });
}

export const lanQueries = {
  settings: resource<LanTransferSettings | null>(
    "settings",
    ipc.lanTransferSettings,
  ),
  shares: resource("shares", ipc.lanTransferSharedDirs),
  addresses: resource("addresses", ipc.lanTransferNetworkAddresses),
  devices: resource("devices", ipc.lanTransferConnectedDevices),
  tasks: resource("tasks", ipc.lanTransferTasks),
  trusted: resource("trusted", ipc.lanTransferTrustedDevices),
  auth: resource("auth", ipc.lanTransferPendingAuthRequests),
};
