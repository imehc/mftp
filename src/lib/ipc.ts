import { commands } from "~/bindings";
import type { DirectoryTransferMode } from "~/store/settings";
import type {
  ExportSection,
  HostInput,
  ImportMode,
  LanSharedDirInput,
  LanTransferSettings,
  LanTrustedDeviceInput,
  VaultEntryInput,
} from "~/types";

type CommandResult<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

const unwrapCommand = async <T, E>(
  promise: Promise<CommandResult<T, E>>,
): Promise<T> => {
  const result = await promise;
  if (result.status === "ok") {
    return result.data;
  }
  throw result.error;
};

const voidCommand = async <E>(
  promise: Promise<CommandResult<null, E>>,
): Promise<void> => {
  await unwrapCommand(promise);
};

// ---- Hosts ----
export const hostsList = () => unwrapCommand(commands.hostsList());
export const hostGet = (id: string) => unwrapCommand(commands.hostGet(id));
export const hostCreate = (input: HostInput) =>
  unwrapCommand(commands.hostCreate(input));
export const hostUpdate = (id: string, input: HostInput) =>
  unwrapCommand(commands.hostUpdate(id, input));
export const hostDelete = (id: string) => voidCommand(commands.hostDelete(id));
export const hostsReorder = (orderedIds: string[]) =>
  unwrapCommand(commands.hostsReorder(orderedIds));

// ---- Keys ----
export const keysList = () => unwrapCommand(commands.keysList());
export const keyImport = (
  label: string,
  sourcePath: string,
  hasPassphrase: boolean,
) => unwrapCommand(commands.keyImport(label, sourcePath, hasPassphrase));
export const keyDelete = (id: string) => voidCommand(commands.keyDelete(id));

// ---- LAN Transfer ----
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
export const lanTransferStop = () =>
  unwrapCommand(commands.lanTransferStop());
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
export const activityLogs = (limit?: number) =>
  unwrapCommand(commands.activityLogs(limit ?? null));
export const activityLogsClear = () => voidCommand(commands.activityLogsClear());
export const activityLogDelete = (id: string) =>
  voidCommand(commands.activityLogDelete(id));

// ---- Game rooms ----
export const gameRoomStatus = () => unwrapCommand(commands.gameRoomStatus());
export const gameRoomCreate = (
  gameId: string,
  roomName: string,
  code: string | null,
  playerName: string,
) => unwrapCommand(commands.gameRoomCreate(gameId, roomName, code, playerName));
export const gameRoomJoin = (
  host: string,
  port: number,
  gameId: string,
  code: string | null,
  playerName: string,
) => unwrapCommand(commands.gameRoomJoin(host, port, gameId, code, playerName));
export const gameRoomDiscover = (gameId: string) =>
  unwrapCommand(commands.gameRoomDiscover(gameId));
export const gameRoomSend = (payload: string) =>
  voidCommand(commands.gameRoomSend(payload));
export const gameRoomLeave = () => voidCommand(commands.gameRoomLeave());

// ---- SSH ----
export const sshConnect = (hostId: string, passphrase?: string) =>
  unwrapCommand(commands.sshConnect(hostId, passphrase ?? null));
export const sshOpenShell = (sessionId: string, cols: number, rows: number) =>
  voidCommand(commands.sshOpenShell(sessionId, cols, rows));
export const sshWrite = (sessionId: string, data: string) =>
  voidCommand(commands.sshWrite(sessionId, data));
export const sshResize = (sessionId: string, cols: number, rows: number) =>
  voidCommand(commands.sshResize(sessionId, cols, rows));
export const sshDisconnect = (sessionId: string) =>
  voidCommand(commands.sshDisconnect(sessionId));

// ---- SFTP ----
export const sftpHome = (sessionId: string) =>
  unwrapCommand(commands.sftpHome(sessionId));
export const sftpStartDir = (sessionId: string, preferred?: string | null) =>
  unwrapCommand(commands.sftpStartDir(sessionId, preferred ?? null));
export const sftpList = (sessionId: string, path: string) =>
  unwrapCommand(commands.sftpList(sessionId, path));
export const sftpInfo = (sessionId: string, path: string) =>
  unwrapCommand(commands.sftpInfo(sessionId, path));
export const sftpMkdir = (sessionId: string, path: string) =>
  voidCommand(commands.sftpMkdir(sessionId, path));
export const sftpRename = (sessionId: string, from: string, to: string) =>
  voidCommand(commands.sftpRename(sessionId, from, to));
export const sftpDelete = (
  sessionId: string,
  path: string,
  isDir: boolean,
  transferId?: string,
) =>
  voidCommand(commands.sftpDelete(
    sessionId,
    path,
    isDir,
    transferId ?? null,
  ));
export const sftpDownload = (
  sessionId: string,
  remote: string,
  local: string,
  transferId?: string,
) =>
  voidCommand(commands.sftpDownload(
    sessionId,
    remote,
    local,
    transferId ?? null,
  ));
export const sftpUpload = (
  sessionId: string,
  local: string,
  remote: string,
  transferId?: string,
) =>
  voidCommand(commands.sftpUpload(
    sessionId,
    local,
    remote,
    transferId ?? null,
  ));
export const sftpExists = (sessionId: string, path: string) =>
  unwrapCommand(commands.sftpExists(sessionId, path));
export const sftpUploadDir = (
  sessionId: string,
  localDir: string,
  remoteParent: string,
  remoteName: string,
  transferMode: DirectoryTransferMode,
  transferId?: string,
) =>
  voidCommand(commands.sftpUploadDir(
    sessionId,
    localDir,
    remoteParent,
    remoteName,
    transferMode,
    transferId ?? null,
  ));
export const sftpDownloadDir = (
  sessionId: string,
  remoteDir: string,
  localDir: string,
  transferMode: DirectoryTransferMode,
  transferId?: string,
) =>
  voidCommand(commands.sftpDownloadDir(
    sessionId,
    remoteDir,
    localDir,
    transferMode,
    transferId ?? null,
  ));
export const sftpCancelTransfer = (transferId: string) =>
  voidCommand(commands.sftpCancelTransfer(transferId));
export const sftpPauseTransfer = (transferId: string) =>
  voidCommand(commands.sftpPauseTransfer(transferId));
export const sftpResumeTransfer = (transferId: string) =>
  voidCommand(commands.sftpResumeTransfer(transferId));
export const sftpResetConnection = (sessionId: string) =>
  voidCommand(commands.sftpResetConnection(sessionId));
export const sftpExtract = (
  sessionId: string,
  remoteArchive: string,
  remoteParent: string,
  outName?: string | null,
) =>
  voidCommand(commands.sftpExtract(
    sessionId,
    remoteArchive,
    remoteParent,
    outName ?? null,
  ));

// ---- Vault ----
export const vaultEntriesList = () => unwrapCommand(commands.vaultEntriesList());
export const vaultEntryCreate = (input: VaultEntryInput) =>
  unwrapCommand(commands.vaultEntryCreate(input));
export const vaultEntryUpdate = (id: string, input: VaultEntryInput) =>
  unwrapCommand(commands.vaultEntryUpdate(id, input));
export const vaultEntryDelete = (id: string) =>
  voidCommand(commands.vaultEntryDelete(id));
export const vaultEntriesReorder = (orderedIds: string[]) =>
  unwrapCommand(commands.vaultEntriesReorder(orderedIds));

// ---- Export / Import ----
export const dataExport = (
  sections: ExportSection[],
  password: string | null,
) => unwrapCommand(commands.dataExport(sections, password));
export const dataInspect = (raw: string) =>
  unwrapCommand(commands.dataInspect(raw));
export const dataImport = (
  raw: string,
  password: string | null,
  mode: ImportMode,
) => unwrapCommand(commands.dataImport(raw, password, mode));
