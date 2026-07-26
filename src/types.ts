export type {
  ActivityLog,
  AppError,
  AuthType,
  GameRoomStatus,
  GameRoomSummary,
  Host,
  HostInput,
  LanAuthRequest,
  LanConnectedDevice,
  LanDiscoveredDevice,
  LanNetworkAddress,
  LanSharedDir,
  LanSharedDirInput,
  LanTransferSettings,
  LanTransferStatus,
  LanTransferTask,
  LanTrustedDevice,
  LanTrustedDeviceInput,
  SftpEntry,
  SftpFileInfo,
  SshKey,
  TransferProgress,
} from "~/bindings";

/** An open terminal/sftp session tab. */
export interface Session {
  id: string;
  hostId: string;
  title: string;
  status: "connecting" | "connected" | "closed" | "error";
  error?: string;
  view: "terminal" | "sftp";
}
