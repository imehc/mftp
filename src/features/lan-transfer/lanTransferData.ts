import * as ipc from "~/lib/ipc";

export async function loadLanTransferCore() {
  const [settings, status, shares, addresses] = await Promise.all([
    ipc.lanTransferSettings(),
    ipc.lanTransferStatus(),
    ipc.lanTransferSharedDirs(),
    ipc.lanTransferNetworkAddresses(),
  ]);
  return { settings, status, shares, addresses };
}

export async function loadLanTransferSecondary() {
  const [devices, tasks, trustedDevices, authRequests] = await Promise.all([
    ipc.lanTransferConnectedDevices(),
    ipc.lanTransferTasks(),
    ipc.lanTransferTrustedDevices(),
    ipc.lanTransferPendingAuthRequests(),
  ]);
  return { devices, tasks, trustedDevices, authRequests };
}

export function scheduleIdleTask(task: () => void): () => void {
  const idleWindow = window as unknown as {
    requestIdleCallback?: (
      callback: () => void,
      options: { timeout: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(task, { timeout: 800 });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, 250);
  return () => window.clearTimeout(id);
}
