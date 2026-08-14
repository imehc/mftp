import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import type { SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";
import type { ConflictResolution } from "~/features/ssh-sftp/components/sftp/ConflictDialog";
import {
  baseName,
  joinLocalPath,
  joinPath,
  nextTransferId,
  validPlainName,
  type ConflictState,
  type LoadingAction,
  type PromptState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";

interface UseSftpTransferActionsOptions {
  sessionId: string;
  cwd: string | null;
  load: (path: string, action?: LoadingAction) => Promise<void>;
  setPrompt: (value: PromptState) => void;
  setConflict: (value: ConflictState) => void;
}

interface UploadDirOptions {
  displayName?: string;
  afterUpload?: () => Promise<void>;
}

export function useSftpTransferActions({
  sessionId,
  cwd,
  load,
  setPrompt,
  setConflict,
}: UseSftpTransferActionsOptions) {
  const { t } = useLingui();
  const startTransfer = useTransfersStore((state) => state.start);
  const finishTransfer = useTransfersStore((state) => state.finish);
  const directoryTransferMode = useSettingsStore(
    (state) => state.directoryTransferMode,
  );

  async function onUpload() {
    if (!cwd) return;
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: t`选择上传文件`,
    });
    if (typeof selected !== "string") return;
    const name = baseName(selected);
    const remote = joinPath(cwd, name);
    const refreshPath = cwd;
    const transferId = nextTransferId();
    const label = t`上传 ${name}`;
    const run = async (resetConnection = false): Promise<void> => {
      if (resetConnection) {
        await ipc.sftpResetConnection(sessionId);
      }
      startTransfer(transferId, label, { retry: () => run(true) });
      try {
        await ipc.sftpUpload(sessionId, selected, remote, transferId);
        finishTransfer(transferId, "success");
        await load(refreshPath);
      } catch (e) {
        const message = String(e);
        if (message === "传输已取消") {
          finishTransfer(transferId, "cancelled");
        } else {
          finishTransfer(transferId, "error", message);
        }
      }
    };
    await run();
  }

  async function onDownload(entry: SftpEntry) {
    if (entry.isDir) return onDownloadDir(entry);
    const dest = await saveDialog({ defaultPath: entry.name, title: t`保存到` });
    if (typeof dest !== "string") return;
    const transferId = nextTransferId();
    const label = t`下载 ${entry.name}`;
    const run = async (resetConnection = false): Promise<void> => {
      if (resetConnection) {
        await ipc.sftpResetConnection(sessionId);
      }
      startTransfer(transferId, label, { retry: () => run(true) });
      try {
        await ipc.sftpDownload(sessionId, entry.path, dest, transferId);
        finishTransfer(transferId, "success");
      } catch (e) {
        const message = String(e);
        if (message === "传输已取消") {
          finishTransfer(transferId, "cancelled");
        } else {
          finishTransfer(transferId, "error", message);
        }
      }
    };
    await run();
  }

  async function onDownloadDir(entry: SftpEntry) {
    setPrompt({
      kind: "downloadDir",
      entry,
      initialName: entry.name,
    });
  }

  async function downloadDirWithName(entry: SftpEntry, folderName: string) {
    const trimmedName = folderName.trim();
    if (!validPlainName(trimmedName)) {
      toast.error(t`名称不能为空，且不能包含斜杠`);
      return;
    }
    setPrompt(null);
    const parent = await openDialog({
      multiple: false,
      directory: true,
      title: t`选择保存位置`,
    });
    if (typeof parent !== "string") return;
    const dest = joinLocalPath(parent, trimmedName);
    const transferMode = directoryTransferMode;
    const transferId = nextTransferId();
    const label = t`下载 ${entry.name}`;
    const run = async (resetConnection = false): Promise<void> => {
      if (resetConnection) {
        await ipc.sftpResetConnection(sessionId);
      }
      startTransfer(transferId, label, { retry: () => run(true) });
      try {
        await ipc.sftpDownloadDir(
          sessionId,
          entry.path,
          dest,
          transferMode,
          transferId,
        );
        finishTransfer(transferId, "success");
      } catch (e) {
        const message = String(e);
        if (message === "传输已取消") {
          finishTransfer(transferId, "cancelled");
        } else {
          finishTransfer(transferId, "error", message);
        }
      }
    };
    await run();
  }

  async function onUploadDir() {
    if (!cwd) return;
    const selected = await openDialog({
      multiple: false,
      directory: true,
      title: t`选择上传文件夹`,
    });
    if (typeof selected !== "string") return;
    const name = baseName(selected);
    await prepareUploadDir(selected, name);
  }

  async function prepareUploadDir(localDir: string, defaultName: string) {
    if (!cwd) return;
    try {
      const exists = await ipc.sftpExists(sessionId, joinPath(cwd, defaultName));
      if (exists) {
        showUploadConflict(localDir, defaultName);
        return;
      }
      setPrompt({
        kind: "uploadDir",
        localDir,
        initialName: defaultName,
      });
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function uploadDirWithPromptName(localDir: string, remoteName: string) {
    if (!validPlainName(remoteName)) {
      toast.error(t`名称不能为空，且不能包含斜杠`);
      return;
    }
    setPrompt(null);
    await uploadDirWithName(localDir, remoteName.trim());
  }

  function showUploadConflict(
    localDir: string,
    remoteName: string,
    initialIncomingName?: string,
    initialExistingName?: string,
  ) {
    setConflict({
      name: remoteName,
      incomingLabel: t`上传的文件夹`,
      initialIncomingName,
      initialExistingName,
      run: async (resolution) => {
        await resolveUploadConflict(localDir, remoteName, resolution);
      },
    });
  }

  async function resolveUploadConflict(
    localDir: string,
    remoteName: string,
    { incomingName, existingName }: ConflictResolution,
  ) {
    if (!cwd) return;
    const targetDir = cwd;

    if (existingName === remoteName) {
      await uploadDirWithName(localDir, incomingName);
      return;
    }

    const existingTargetTaken = await ipc.sftpExists(
      sessionId,
      joinPath(targetDir, existingName),
    );
    if (existingTargetTaken) {
      toast.error(t`远端已存在 “${existingName}”，请重新命名`);
      showUploadConflict(localDir, remoteName, incomingName, existingName);
      return;
    }

    if (incomingName !== remoteName) {
      await uploadDirWithName(localDir, incomingName, {
        afterUpload: async () => {
          await ipc.sftpRename(
            sessionId,
            joinPath(targetDir, remoteName),
            joinPath(targetDir, existingName),
          );
          await load(targetDir);
        },
      });
      return;
    }

    const stagingName = pickStagingName(remoteName);
    await uploadDirWithName(localDir, stagingName, {
      displayName: remoteName,
      afterUpload: async () => {
        await ipc.sftpRename(
          sessionId,
          joinPath(targetDir, remoteName),
          joinPath(targetDir, existingName),
        );
        await ipc.sftpRename(
          sessionId,
          joinPath(targetDir, stagingName),
          joinPath(targetDir, remoteName),
        );
        await load(targetDir);
      },
    });
  }

  function pickStagingName(remoteName: string): string {
    const suffix = nextTransferId().slice(0, 8);
    return `.${remoteName}.mftp-uploading-${suffix}`;
  }

  async function uploadDirWithName(
    localDir: string,
    remoteName: string,
    options?: UploadDirOptions,
  ) {
    if (!cwd) return;
    try {
      const exists = await ipc.sftpExists(sessionId, joinPath(cwd, remoteName));
      if (exists) {
        showUploadConflict(localDir, remoteName);
        return;
      }
    } catch (e) {
      toast.error(String(e));
      return;
    }
    await runUploadDir(localDir, remoteName, options);
  }

  async function runUploadDir(
    localDir: string,
    remoteName: string,
    options?: UploadDirOptions,
  ) {
    if (!cwd) return;
    const transferId = nextTransferId();
    const transferMode = directoryTransferMode;
    const remoteParent = cwd;
    const name = options?.displayName ?? remoteName;
    const label = t`上传 ${name}`;
    const run = async (resetConnection = false): Promise<void> => {
      if (resetConnection) {
        await ipc.sftpResetConnection(sessionId);
      }
      startTransfer(transferId, label, { retry: () => run(true) });
      try {
        await ipc.sftpUploadDir(
          sessionId,
          localDir,
          remoteParent,
          remoteName,
          transferMode,
          transferId,
        );
        if (options?.afterUpload) {
          await options.afterUpload();
        }
        finishTransfer(transferId, "success");
        await load(remoteParent);
      } catch (e) {
        const message = String(e);
        if (message === "传输已取消") {
          finishTransfer(transferId, "cancelled");
        } else {
          finishTransfer(transferId, "error", message);
        }
      }
    };
    await run();
  }

  return {
    onUpload,
    onDownload,
    onUploadDir,
    downloadDirWithName,
    uploadDirWithPromptName,
  };
}
