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

export interface TransferProgress {
  id: string;
  phase: string;
  transferred: number;
  total?: number | null;
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
