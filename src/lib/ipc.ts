import { listen } from "@tauri-apps/api/event";

import type { AppDataModule } from "~/bindings";
import {
  commands,
  type PoetryTranslation,
  type PoetryTranslationMode,
  type PoetryTranslationStreamEvent,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { poetryTranslationStreamEvent } from "~/lib/events";
import type { DirectoryTransferMode } from "~/store/settings";
import type {
  BtControlAction,
  ExportSection,
  HostInput,
  ImportMode,
  LanSharedDirInput,
  LanTransferSettings,
  LanTrustedDeviceInput,
  PoetryAuthorsRequest,
  PoetryBrowseRequest,
  PoetrySearchRequest,
  TodoItemInput,
  VaultEntryInput,
} from "~/types";

type CommandResult<T, E> =
  { status: "ok"; data: T } | { status: "error"; error: E };

const unwrapCommand = async <T, E>(
  promise: Promise<CommandResult<T, E>>,
): Promise<T> => {
  try {
    const result = await promise;
    if (result.status === "ok") {
      return result.data;
    }
    throw toIpcError(result.error);
  } catch (error) {
    // 同时收口命令返回的错误和原生 IPC 拒绝，重复转换保持原对象。
    throw toIpcError(error);
  }
};

const voidCommand = async <E>(
  promise: Promise<CommandResult<null, E>>,
): Promise<void> => {
  await unwrapCommand(promise);
};

// ---- 模型资源与本地库 ----
export const modelViewerOpen = (path: string) =>
  unwrapCommand(commands.modelViewerOpen(path));
export const modelViewerAttach = (id: string, key: string, path: string) =>
  voidCommand(commands.modelViewerAttach(id, key, path));
export const modelViewerSize = (id: string, key: string) =>
  unwrapCommand(commands.modelViewerSize(id, key));
export const modelViewerRead = (
  id: string,
  key: string,
  offset: number,
  length: number,
) => unwrapCommand(commands.modelViewerRead(id, key, offset, length));
export const modelViewerClose = (id: string) =>
  voidCommand(commands.modelViewerClose(id));

export const modelLibraryCatalog = () =>
  unwrapCommand(commands.modelLibraryCatalog());
export const modelLibraryBegin = (
  input: Parameters<typeof commands.modelLibraryBegin>[0],
) => unwrapCommand(commands.modelLibraryBegin(input));
export const modelLibraryWrite = (
  id: string,
  key: string,
  offset: number,
  bytes: number[],
) => voidCommand(commands.modelLibraryWrite(id, key, offset, bytes));
export const modelLibraryCommit = (id: string) =>
  voidCommand(commands.modelLibraryCommit(id));
export const modelLibraryDocument = (id: string) =>
  unwrapCommand(commands.modelLibraryDocument(id));
export const modelLibraryRead = (id: string, key: string, offset: number) =>
  unwrapCommand(commands.modelLibraryRead(id, key, offset));
export const modelLibraryEdit = (
  id: string,
  input: Parameters<typeof commands.modelLibraryEdit>[1],
) => voidCommand(commands.modelLibraryEdit(id, input));
export const modelLibrarySaveView = (
  id: string,
  view: Parameters<typeof commands.modelLibrarySaveView>[1],
) => voidCommand(commands.modelLibrarySaveView(id, view));
export const modelLibraryDelete = (id: string, draftOnly = false) =>
  voidCommand(commands.modelLibraryDelete(id, draftOnly));
export const modelLibraryThumbnail = (id: string, bytes: number[]) =>
  voidCommand(commands.modelLibraryThumbnail(id, bytes));
export const modelLibraryReadThumbnail = (id: string) =>
  unwrapCommand(commands.modelLibraryReadThumbnail(id));
export const modelLibraryCache = (max: number, clear: boolean) =>
  voidCommand(commands.modelLibraryCache(max, clear));

// ---- AI 多地址公开配置 ----

export const aiConfigurationGet = () =>
  unwrapCommand(commands.aiConfigurationGet());
export const aiProviderCreate = (
  input: Parameters<typeof commands.aiProviderCreate>[0],
) => unwrapCommand(commands.aiProviderCreate(input));
export const aiProviderUpdate = (
  input: Parameters<typeof commands.aiProviderUpdate>[0],
) => unwrapCommand(commands.aiProviderUpdate(input));
export const aiProviderDelete = (
  input: Parameters<typeof commands.aiProviderDelete>[0],
) => unwrapCommand(commands.aiProviderDelete(input));
export const aiKeySave = (input: Parameters<typeof commands.aiKeySave>[0]) =>
  unwrapCommand(commands.aiKeySave(input));
export const aiKeyDelete = (
  input: Parameters<typeof commands.aiKeyDelete>[0],
) => unwrapCommand(commands.aiKeyDelete(input));
export const aiModelSave = (
  input: Parameters<typeof commands.aiModelSave>[0],
) => unwrapCommand(commands.aiModelSave(input));
export const aiModelDelete = (
  input: Parameters<typeof commands.aiModelDelete>[0],
) => unwrapCommand(commands.aiModelDelete(input));
export const aiProviderActivate = (
  input: Parameters<typeof commands.aiProviderActivate>[0],
) => unwrapCommand(commands.aiProviderActivate(input));
export const aiProviderSelect = (
  input: Parameters<typeof commands.aiProviderSelect>[0],
) => unwrapCommand(commands.aiProviderSelect(input));
export const aiModelSwitch = (
  input: Parameters<typeof commands.aiModelSwitch>[0],
) => unwrapCommand(commands.aiModelSwitch(input));
export const aiStreamingUpdate = (
  input: Parameters<typeof commands.aiStreamingUpdate>[0],
) => unwrapCommand(commands.aiStreamingUpdate(input));
export const aiProviderTest = (
  input: Parameters<typeof commands.aiProviderTest>[0],
) => voidCommand(commands.aiProviderTest(input));

// ---- 主机 ----
export const hostsList = () => unwrapCommand(commands.hostsList());
export const hostGet = (id: string) => unwrapCommand(commands.hostGet(id));
export const hostCreate = (input: HostInput) =>
  unwrapCommand(commands.hostCreate(input));
export const hostUpdate = (id: string, input: HostInput) =>
  unwrapCommand(commands.hostUpdate(id, input));
export const hostDelete = (id: string) => voidCommand(commands.hostDelete(id));
export const hostsReorder = (orderedIds: string[]) =>
  unwrapCommand(commands.hostsReorder(orderedIds));

// ---- 密钥 ----
export const keysList = () => unwrapCommand(commands.keysList());
export const keyImport = (
  label: string,
  sourcePath: string,
  hasPassphrase: boolean,
) => unwrapCommand(commands.keyImport(label, sourcePath, hasPassphrase));
export const keyDelete = (id: string) => voidCommand(commands.keyDelete(id));

// ---- 局域网传输 ----
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
export const activityLogs = (
  limit?: number,
  source?: string,
  result?: string,
) =>
  unwrapCommand(
    commands.activityLogs(limit ?? null, source ?? null, result ?? null),
  );
export const activityLogsClear = () =>
  voidCommand(commands.activityLogsClear());
export const activityLogDelete = (id: string) =>
  voidCommand(commands.activityLogDelete(id));

// ---- 游戏房间 ----
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
export const gameRoomSend = (instanceId: string, payload: string) =>
  voidCommand(commands.gameRoomSend(instanceId, payload));
export const gameRoomLeave = (instanceId: string) =>
  voidCommand(commands.gameRoomLeave(instanceId));

// ---- SSH 命令 ----
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
export const sshSystemStats = (sessionId: string) =>
  unwrapCommand(commands.sshSystemStats(sessionId));

// ---- SFTP 命令 ----
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
  voidCommand(commands.sftpDelete(sessionId, path, isDir, transferId ?? null));
export const sftpDownload = (
  sessionId: string,
  remote: string,
  local: string,
  transferId?: string,
) =>
  voidCommand(
    commands.sftpDownload(sessionId, remote, local, transferId ?? null),
  );
export const sftpUpload = (
  sessionId: string,
  local: string,
  remote: string,
  transferId?: string,
) =>
  voidCommand(
    commands.sftpUpload(sessionId, local, remote, transferId ?? null),
  );
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
  voidCommand(
    commands.sftpUploadDir(
      sessionId,
      localDir,
      remoteParent,
      remoteName,
      transferMode,
      transferId ?? null,
    ),
  );
export const sftpDownloadDir = (
  sessionId: string,
  remoteDir: string,
  localDir: string,
  transferMode: DirectoryTransferMode,
  transferId?: string,
) =>
  voidCommand(
    commands.sftpDownloadDir(
      sessionId,
      remoteDir,
      localDir,
      transferMode,
      transferId ?? null,
    ),
  );
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
  voidCommand(
    commands.sftpExtract(
      sessionId,
      remoteArchive,
      remoteParent,
      outName ?? null,
    ),
  );

// ---- 保险库 ----
export const vaultEntriesList = () =>
  unwrapCommand(commands.vaultEntriesList());
export const vaultEntryCreate = (input: VaultEntryInput) =>
  unwrapCommand(commands.vaultEntryCreate(input));
export const vaultEntryUpdate = (id: string, input: VaultEntryInput) =>
  unwrapCommand(commands.vaultEntryUpdate(id, input));
export const vaultEntryDelete = (id: string) =>
  voidCommand(commands.vaultEntryDelete(id));
export const vaultEntriesReorder = (orderedIds: string[]) =>
  unwrapCommand(commands.vaultEntriesReorder(orderedIds));

// ---- 待办事项 ----
export const todoItemsList = () => unwrapCommand(commands.todoItemsList());
export const todoItemCreate = (input: TodoItemInput) =>
  unwrapCommand(commands.todoItemCreate(input));
export const todoItemUpdate = (id: string, input: TodoItemInput) =>
  unwrapCommand(commands.todoItemUpdate(id, input));
export const todoItemDelete = (id: string) =>
  voidCommand(commands.todoItemDelete(id));

// ---- 导出 / 导入 ----
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
export const appDataUsage = () => unwrapCommand(commands.appDataUsage());
export const appDataClear = (module: AppDataModule) =>
  unwrapCommand(commands.appDataClear(module));
export const appDataReset = () => unwrapCommand(commands.appDataReset());

// ---- 诗词库 ----
export const poetryCollections = () =>
  unwrapCommand(commands.poetryCollections());
export const poetrySyncCheck = () => unwrapCommand(commands.poetrySyncCheck());
export const poetrySyncStart = (collectionIds: string[]) =>
  voidCommand(commands.poetrySyncStart(collectionIds));
export const poetrySyncImportLocal = (path: string, collectionIds: string[]) =>
  voidCommand(commands.poetrySyncImportLocal(path, collectionIds));
export const poetrySyncCancel = () => voidCommand(commands.poetrySyncCancel());
export const poetryCollectionDelete = (id: string) =>
  voidCommand(commands.poetryCollectionDelete(id));
export const poetryContentIndexBuild = (enable: boolean) =>
  voidCommand(commands.poetryContentIndexBuild(enable));
export const poetryContentIndexStatus = () =>
  unwrapCommand(commands.poetryContentIndexStatus());
export const poetryBrowse = (req: PoetryBrowseRequest) =>
  unwrapCommand(commands.poetryBrowse(req));
export const poetryPoem = (uid: string) =>
  unwrapCommand(commands.poetryPoem(uid));
export const poetrySearch = (req: PoetrySearchRequest) =>
  unwrapCommand(commands.poetrySearch(req));
export const poetryAuthors = (req: PoetryAuthorsRequest) =>
  unwrapCommand(commands.poetryAuthors(req));
export const poetryDaily = () => unwrapCommand(commands.poetryDaily());
export const poetryRandom = () => unwrapCommand(commands.poetryRandom(null));
export const poetryAnnotationsInstall = () =>
  voidCommand(commands.poetryAnnotationsInstall());
export const poetryAnnotationsStatus = () =>
  unwrapCommand(commands.poetryAnnotationsStatus());
export const poetryAnnotationsDelete = () =>
  voidCommand(commands.poetryAnnotationsDelete());
export const poetryTranslationPackImport = (raw: string) =>
  unwrapCommand(commands.poetryTranslationPackImport(raw));
export const poetryTranslationPacks = () =>
  unwrapCommand(commands.poetryTranslationPacks());
export const poetryTranslationPackDelete = (id: string) =>
  voidCommand(commands.poetryTranslationPackDelete(id));
export const poetryPackTranslationsList = (uid: string) =>
  unwrapCommand(commands.listPoetryPackTranslations(uid));
export const poetryTranslationsList = (uid: string) =>
  unwrapCommand(commands.listPoetryTranslations(uid));

export interface PoetryGenerationHandle {
  /**
   * 生成完成时返回译文；调用方在 `detach()` 之后不应再使用结果。
   * 离开时若请求尚未开始，返回 null（不会为离开的订阅者新起请求）。
   */
  promise: Promise<PoetryTranslation | null>;
  /**
   * 停止接收流式增量。
   *
   * 这不是「取消后端任务」：请求一旦开始，后端会继续执行并自行释放任务锁。
   * 真正的取消需要后端提供契约，前端不得用按钮文案假装已经取消。
   */
  detach: () => void;
}

export const poetryTranslationGenerate = (
  uid: string,
  mode: PoetryTranslationMode,
  onDelta: (delta: string) => void,
): PoetryGenerationHandle => {
  const requestId = crypto.randomUUID();
  let detached = false;
  let unlisten: (() => void) | null = null;

  const cleanup = () => {
    const listener = unlisten;
    unlisten = null;
    listener?.();
  };

  const promise = listen<PoetryTranslationStreamEvent>(
    poetryTranslationStreamEvent(requestId),
    (event) => onDelta(event.payload.delta),
  ).then(async (listener) => {
    unlisten = listener;
    if (detached) {
      cleanup();
      return null;
    }
    try {
      return await unwrapCommand(
        commands.generatePoetryTranslation(uid, mode, requestId),
      );
    } finally {
      cleanup();
    }
  });
  return {
    promise,
    detach: () => {
      detached = true;
      cleanup();
    },
  };
};

export const poetryTranslationUpdate = (
  uid: string,
  mode: PoetryTranslationMode,
  content: string,
) => unwrapCommand(commands.updatePoetryTranslation(uid, mode, content));
export const poetryTranslationDelete = (
  uid: string,
  mode: PoetryTranslationMode,
) => voidCommand(commands.deletePoetryTranslation(uid, mode));

// ---- BT ----
export const btProbe = (source: string) =>
  unwrapCommand(commands.btProbe(source));
export const btAddDownload = (
  source: string,
  infoHash: string,
  fileIndices: number[],
) => unwrapCommand(commands.btAddDownload(source, infoHash, fileIndices));
export const btExport = (infoHash: string, destDir: string) =>
  unwrapCommand(commands.btExport(infoHash, destDir));
export const btList = () => unwrapCommand(commands.btList());
export const btControl = (
  infoHash: string,
  action: BtControlAction,
  deleteFiles: boolean,
) => voidCommand(commands.btControl(infoHash, action, deleteFiles));
export const btTaskPeers = (infoHash: string) =>
  unwrapCommand(commands.btTaskPeers(infoHash));
export const btDhtStatus = () => unwrapCommand(commands.btDhtStatus());
export const btPlayability = (
  infoHash: string,
  fileIndex: number,
  prepare: boolean,
) => unwrapCommand(commands.btPlayability(infoHash, fileIndex, prepare));

export const btBrowseFiles = (infoHash: string, path: string | null = null) =>
  unwrapCommand(commands.btBrowseFiles(infoHash, path));
export const btPreviewFile = (infoHash: string, path: string) =>
  unwrapCommand(commands.btPreviewFile(infoHash, path));
export const btOpenFile = (infoHash: string, path: string) =>
  voidCommand(commands.btOpenFile(infoHash, path));
