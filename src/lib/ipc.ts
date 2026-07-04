import { invoke } from "@tauri-apps/api/core";
import type { DirectoryTransferMode } from "~/store/settings";
import type { Host, HostInput, SftpEntry, SftpFileInfo, SshKey } from "~/types";

// ---- Hosts ----
export const hostsList = () => invoke<Host[]>("hosts_list");
export const hostGet = (id: string) => invoke<Host>("host_get", { id });
export const hostCreate = (input: HostInput) =>
  invoke<Host>("host_create", { input });
export const hostUpdate = (id: string, input: HostInput) =>
  invoke<Host>("host_update", { id, input });
export const hostDelete = (id: string) => invoke<void>("host_delete", { id });

// ---- Keys ----
export const keysList = () => invoke<SshKey[]>("keys_list");
export const keyImport = (
  label: string,
  sourcePath: string,
  hasPassphrase: boolean,
) => invoke<SshKey>("key_import", { label, sourcePath, hasPassphrase });
export const keyDelete = (id: string) => invoke<void>("key_delete", { id });

// ---- SSH ----
export const sshConnect = (hostId: string, passphrase?: string) =>
  invoke<string>("ssh_connect", { hostId, passphrase: passphrase ?? null });
export const sshOpenShell = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("ssh_open_shell", { sessionId, cols, rows });
export const sshWrite = (sessionId: string, data: string) =>
  invoke<void>("ssh_write", { sessionId, data });
export const sshResize = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("ssh_resize", { sessionId, cols, rows });
export const sshDisconnect = (sessionId: string) =>
  invoke<void>("ssh_disconnect", { sessionId });

// ---- SFTP ----
export const sftpHome = (sessionId: string) =>
  invoke<string>("sftp_home", { sessionId });
export const sftpStartDir = (sessionId: string, preferred?: string | null) =>
  invoke<string>("sftp_start_dir", { sessionId, preferred: preferred ?? null });
export const sftpList = (sessionId: string, path: string) =>
  invoke<SftpEntry[]>("sftp_list", { sessionId, path });
export const sftpInfo = (sessionId: string, path: string) =>
  invoke<SftpFileInfo>("sftp_info", { sessionId, path });
export const sftpMkdir = (sessionId: string, path: string) =>
  invoke<void>("sftp_mkdir", { sessionId, path });
export const sftpRename = (sessionId: string, from: string, to: string) =>
  invoke<void>("sftp_rename", { sessionId, from, to });
export const sftpDelete = (
  sessionId: string,
  path: string,
  isDir: boolean,
  transferId?: string,
) =>
  invoke<void>("sftp_delete", {
    sessionId,
    path,
    isDir,
    transferId: transferId ?? null,
  });
export const sftpDownload = (
  sessionId: string,
  remote: string,
  local: string,
  transferId?: string,
) =>
  invoke<void>("sftp_download", {
    sessionId,
    remote,
    local,
    transferId: transferId ?? null,
  });
export const sftpUpload = (
  sessionId: string,
  local: string,
  remote: string,
  transferId?: string,
) =>
  invoke<void>("sftp_upload", {
    sessionId,
    local,
    remote,
    transferId: transferId ?? null,
  });
export const sftpExists = (sessionId: string, path: string) =>
  invoke<boolean>("sftp_exists", { sessionId, path });
export const sftpUploadDir = (
  sessionId: string,
  localDir: string,
  remoteParent: string,
  remoteName: string,
  transferMode: DirectoryTransferMode,
  transferId?: string,
) =>
  invoke<void>("sftp_upload_dir", {
    sessionId,
    localDir,
    remoteParent,
    remoteName,
    transferMode,
    transferId: transferId ?? null,
  });
export const sftpDownloadDir = (
  sessionId: string,
  remoteDir: string,
  localDir: string,
  transferMode: DirectoryTransferMode,
  transferId?: string,
) =>
  invoke<void>("sftp_download_dir", {
    sessionId,
    remoteDir,
    localDir,
    transferMode,
    transferId: transferId ?? null,
  });
export const sftpCancelTransfer = (transferId: string) =>
  invoke<void>("sftp_cancel_transfer", { transferId });
export const sftpExtract = (
  sessionId: string,
  remoteArchive: string,
  remoteParent: string,
  outName?: string | null,
) =>
  invoke<void>("sftp_extract", {
    sessionId,
    remoteArchive,
    remoteParent,
    outName: outName ?? null,
  });
