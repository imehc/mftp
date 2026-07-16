export type AuthType = "password" | "key";

export interface Host {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  keyId?: string;
  defaultPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HostInput {
  label: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string | null;
  keyId?: string | null;
  defaultPath?: string | null;
}

export interface SshKey {
  id: string;
  label: string;
  filename: string;
  hasPassphrase: boolean;
  createdAt: number;
}

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number;
  mode: number;
}

export interface SftpFileInfo extends SftpEntry {
  atime: number;
  createdAt?: number | null;
  uid?: number | null;
  gid?: number | null;
}

export interface TransferProgress {
  id: string;
  phase: string;
  transferred: number;
  total?: number | null;
}

export interface LanTransferSettings {
  deviceName: string;
  port: number;
  bindHost: string;
  downloadDir: string;
  autoStart: boolean;
  securityMode: string;
  defaultPermission: string;
  maxConcurrentTransfers: number;
}

export interface LanTransferStatus {
  running: boolean;
  host?: string | null;
  port?: number | null;
  url?: string | null;
  onlineConnections: number;
  authMode: string;
  confirmationCode?: string | null;
}

export interface LanConnectedDevice {
  id: string;
  ip: string;
  deviceName: string;
  permission: string;
  connectedAt: number;
  lastSeen: number;
  currentOperation: string;
}

export interface LanAuthRequest {
  id: string;
  ip: string;
  deviceName: string;
  accessType: string;
  requestedAt: number;
}

export interface LanNetworkAddress {
  interfaceName: string;
  ip: string;
  recommended: boolean;
}

export interface LanDiscoveredDevice {
  id: string;
  deviceName: string;
  ip: string;
  port: number;
  url: string;
  online: boolean;
  lastSeen: number;
}

export interface LanTransferTask {
  id: string;
  direction: string;
  fileName: string;
  ip: string;
  status: string;
  transferred: number;
  total: number;
  startedAt: number;
  updatedAt: number;
}

export interface LanTrustedDevice {
  id: string;
  label: string;
  ip: string;
  createdAt: number;
}

export interface LanTrustedDeviceInput {
  label: string;
  ip: string;
}

export interface LanSharedDir {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface LanSharedDirInput {
  name: string;
  path: string;
}

export interface ActivityLog {
  id: string;
  createdAt: number;
  source: string;
  ip: string;
  requestType: string;
  result: string;
  detail?: string | null;
}

/** An open terminal/sftp session tab. */
export interface Session {
  id: string; // backend session id
  hostId: string;
  title: string;
  status: "connecting" | "connected" | "closed" | "error";
  error?: string;
  view: "terminal" | "sftp";
}
