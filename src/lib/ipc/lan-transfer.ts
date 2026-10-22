import { commands } from "~/bindings";
import { unwrapCommand, voidCommand } from "~/lib/ipc-result";
import type {
  LanSharedDirInput,
  LanTransferSettings,
  LanTrustedDeviceInput,
} from "~/types";

export const lanTransferSettings = () =>
  unwrapCommand(commands.lanTransferSettings());
export const lanTransferSaveSettings = (settings: LanTransferSettings) =>
  unwrapCommand(commands.lanTransferSaveSettings(settings));
export const lanTransferStatus = () =>
  unwrapCommand(commands.lanTransferStatus());
export const lanTransferNetworkAddresses = () =>
  unwrapCommand(commands.lanTransferNetworkAddresses());
export const lanTransferDiscoverDevices = () =>
  unwrapCommand(commands.lanTransferDiscoverDevices());
export const lanTransferConnectedDevices = () =>
  unwrapCommand(commands.lanTransferConnectedDevices());
export const lanTransferPendingAuthRequests = () =>
  unwrapCommand(commands.lanTransferPendingAuthRequests());
export const lanTransferApproveAuthRequest = (id: string, permission: string) =>
  unwrapCommand(commands.lanTransferApproveAuthRequest(id, permission));
export const lanTransferRejectAuthRequest = (id: string) =>
  unwrapCommand(commands.lanTransferRejectAuthRequest(id));
export const lanTransferDisconnectDevice = (id: string) =>
  voidCommand(commands.lanTransferDisconnectDevice(id));
export const lanTransferTasks = () =>
  unwrapCommand(commands.lanTransferTasks());
export const lanTransferCancelTask = (id: string) =>
  voidCommand(commands.lanTransferCancelTask(id));
export const lanTransferStart = () =>
  unwrapCommand(commands.lanTransferStart());
export const lanTransferStop = () => unwrapCommand(commands.lanTransferStop());
export const lanTransferSharedDirs = () =>
  unwrapCommand(commands.lanTransferSharedDirs());
export const lanTransferAddSharedDir = (input: LanSharedDirInput) =>
  unwrapCommand(commands.lanTransferAddSharedDir(input));
export const lanTransferDeleteSharedDir = (id: string) =>
  voidCommand(commands.lanTransferDeleteSharedDir(id));
export const lanTransferTrustedDevices = () =>
  unwrapCommand(commands.lanTransferTrustedDevices());
export const lanTransferAddTrustedDevice = (input: LanTrustedDeviceInput) =>
  unwrapCommand(commands.lanTransferAddTrustedDevice(input));
export const lanTransferDeleteTrustedDevice = (id: string) =>
  voidCommand(commands.lanTransferDeleteTrustedDevice(id));
