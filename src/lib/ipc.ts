import { listen } from "@tauri-apps/api/event";

export * from "./ipc/filesystem";
export * from "./ipc/lan-transfer";
export * from "./ipc/speech";
export * from "./ipc/translation";

import type {
  AppDataModule,
  McpCredentialInput,
  ModelExportAction,
  TodoNoteSaveInput,
} from "~/bindings";
import {
  commands,
  type DirectoryTransferMode,
  type PoetryTranslation,
  type PoetryTranslationMode,
  type PoetryTranslationStreamEvent,
} from "~/bindings";
import { poetryTranslationStreamEvent } from "~/lib/events";
import { unwrapCommand, voidCommand } from "~/lib/ipc-result";
import type {
  BtControlAction,
  ExportSection,
  HostInput,
  ImportMode,
  PoetryAuthorsRequest,
  PoetryBrowseRequest,
  PoetrySearchRequest,
  TodoItemInput,
  VaultEntryInput,
} from "~/types";

export const mcpModuleCatalog = () =>
  unwrapCommand(commands.mcpModuleCatalog());
export const mcpSnapshot = () => unwrapCommand(commands.mcpSnapshot());
export const mcpConfigure = (port: number) =>
  voidCommand(commands.mcpConfigure(port));
export const mcpStart = () => voidCommand(commands.mcpStart());
export const mcpStop = () => voidCommand(commands.mcpStop());
export const mcpCredentialCreate = (input: McpCredentialInput) =>
  unwrapCommand(commands.mcpCredentialCreate(input));
export const mcpCredentialUpdate = (id: string, input: McpCredentialInput) =>
  voidCommand(commands.mcpCredentialUpdate(id, input));
export const mcpCredentialRotate = (id: string, input: McpCredentialInput) =>
  unwrapCommand(commands.mcpCredentialRotate(id, input));
export const mcpCredentialRevoke = (id: string) =>
  voidCommand(commands.mcpCredentialRevoke(id));

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
) => unwrapCommand(commands.aiProviderTest(input));
export const aiProviderTestStreaming = (
  input: Parameters<typeof commands.aiProviderTestStreaming>[0],
) => unwrapCommand(commands.aiProviderTestStreaming(input));

export const diagnosticsSnapshot = (after: number) =>
  unwrapCommand(commands.diagnosticsSnapshot(after));
export const diagnosticsClear = () => commands.diagnosticsClear();

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

/** 用表单中的未保存配置测试连接，不注册会话、不写入主机。 */
export const sshTestConnection = (input: HostInput, passphrase?: string) =>
  unwrapCommand(commands.sshTestConnection(input, passphrase ?? null));

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

// ---- rsync 目录同步 ----
export const rsyncCapabilities = (sessionId: string, refresh: boolean) =>
  unwrapCommand(commands.rsyncCapabilities(sessionId, refresh));
export const rsyncPreview = (
  sessionId: string,
  direction: Parameters<typeof commands.rsyncPreview>[1],
  localDir: string,
  remoteDir: string,
  deleteExtraneous: boolean,
) =>
  unwrapCommand(
    commands.rsyncPreview(
      sessionId,
      direction,
      localDir,
      remoteDir,
      deleteExtraneous,
    ),
  );
export const rsyncTransfer = (
  sessionId: string,
  token: string,
  direction: Parameters<typeof commands.rsyncTransfer>[2],
  localDir: string,
  remoteDir: string,
  deleteExtraneous: boolean,
  transferId?: string,
) =>
  unwrapCommand(
    commands.rsyncTransfer(
      sessionId,
      token,
      direction,
      localDir,
      remoteDir,
      deleteExtraneous,
      transferId ?? null,
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
export const todoItemSetCompleted = (id: string, completed: boolean) =>
  unwrapCommand(commands.todoItemSetCompleted(id, completed));
export const todoItemSetAbandoned = (id: string, abandoned: boolean) =>
  unwrapCommand(commands.todoItemSetAbandoned(id, abandoned));
export const todoNoteDetails = (id: string) =>
  unwrapCommand(commands.todoNoteDetails(id));
export const todoNoteSummaries = () =>
  unwrapCommand(commands.todoNoteSummaries());
export const todoNoteDraftBegin = (itemId: string | null) =>
  unwrapCommand(commands.todoNoteDraftBegin(itemId));
export const todoNoteDraftClose = (draftId: string) =>
  voidCommand(commands.todoNoteDraftClose(draftId));
export const todoNoteClipboardRead = (draftId: string, textOnly: boolean) =>
  unwrapCommand(commands.todoNoteClipboardRead(draftId, textOnly));

export const todoNoteImageImport = (draftId: string, dataBase64: string) =>
  unwrapCommand(commands.todoNoteImageImport(draftId, dataBase64));
export const todoNoteImageRead = (
  assetId: string,
  itemId: string | null,
  draftId: string | null,
  thumbnail: boolean,
) =>
  unwrapCommand(
    commands.todoNoteImageRead(assetId, itemId, draftId, thumbnail),
  );
export const todoNoteImageCopy = (
  draftId: string,
  sourceItemId: string,
  assetId: string,
) => unwrapCommand(commands.todoNoteImageCopy(draftId, sourceItemId, assetId));
export const todoNoteSave = (input: TodoNoteSaveInput) =>
  unwrapCommand(commands.todoNoteSave(input));

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
export const appDataResetStatus = () =>
  unwrapCommand(commands.appDataResetStatus());
export const appDataResetResume = (id: string) =>
  unwrapCommand(commands.appDataResetResume(id));
export const appDataResetFinish = (id: string) =>
  voidCommand(commands.appDataResetFinish(id));

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
   * 停止接收流式增量，但不打断后端任务。
   *
   * 离开页面时用它即可：请求会自行完成并保存，只是不再回显。
   */
  detach: () => void;
  /**
   * 真正取消后端生成：请求以 `ai:cancelled` 结束，不落库。
   * 只有用户明确点「取消生成」时才调用它。
   */
  cancel: () => Promise<void>;
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
    cancel: () => {
      detached = true;
      cleanup();
      return voidCommand(commands.cancelPoetryTranslation(requestId));
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

export const modelExportBegin = (name: string, size: number) =>
  unwrapCommand(commands.modelExportBegin(name, size));
export const modelExportWrite = (id: string, offset: number, bytes: number[]) =>
  voidCommand(commands.modelExportWrite(id, offset, bytes));
export const modelExportPresent = (id: string, action: ModelExportAction) =>
  unwrapCommand(commands.modelExportPresent(id, action));
export const modelExportCancel = (id: string) =>
  voidCommand(commands.modelExportCancel(id));
export const modelExportClose = (id: string) =>
  voidCommand(commands.modelExportClose(id));

export const modelAttachmentList = (model: string) =>
  unwrapCommand(commands.modelAttachmentList(model));
export const modelAttachmentAdd = (
  model: string,
  name: string,
  bytes: number[],
) => unwrapCommand(commands.modelAttachmentAdd(model, name, bytes));
export const modelAttachmentRead = (model: string, id: string) =>
  unwrapCommand(commands.modelAttachmentRead(model, id));
export const modelAttachmentDelete = (model: string, id: string) =>
  voidCommand(commands.modelAttachmentDelete(model, id));

export const modelEnvironmentBegin = (name: string, size: number) =>
  unwrapCommand(commands.modelEnvironmentBegin(name, size));
export const modelEnvironmentWrite = (
  id: string,
  offset: number,
  bytes: number[],
) => voidCommand(commands.modelEnvironmentWrite(id, offset, bytes));
export const modelEnvironmentCommit = (id: string) =>
  voidCommand(commands.modelEnvironmentCommit(id));
export const modelEnvironmentCurrent = () =>
  unwrapCommand(commands.modelEnvironmentCurrent());
export const modelEnvironmentRead = (id: string, offset: number) =>
  unwrapCommand(commands.modelEnvironmentRead(id, offset));
export const modelEnvironmentAbort = (id: string) =>
  voidCommand(commands.modelEnvironmentAbort(id));
export const modelEnvironmentClear = () =>
  voidCommand(commands.modelEnvironmentClear());

export const modelSystemPoll = () => unwrapCommand(commands.modelSystemPoll());
