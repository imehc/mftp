import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import type { SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { useTransfersStore } from "~/store/transfers";
import type { ConflictResolution } from "~/features/ssh-sftp/components/sftp/ConflictDialog";
import {
  archiveStem,
  isSameOrChildPath,
  joinPath,
  nextTransferId,
  normalizeRemotePath,
  validPlainName,
  type ConflictState,
  type DirectoryPickerState,
  type ExtractState,
  type LoadingAction,
  type PromptState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
interface UseSftpRemoteActionsOptions {
  sessionId: string;
  cwd: string | null;
  load: (path: string, action?: LoadingAction) => Promise<void>;
  setBusy: (value: string | null) => void;
  setPrompt: (value: PromptState) => void;
  setConflict: (value: ConflictState) => void;
  setDirectoryPicker: (value: DirectoryPickerState) => void;
}
export function useSftpRemoteActions({
  sessionId,
  cwd,
  load,
  setBusy,
  setPrompt,
  setConflict,
  setDirectoryPicker,
}: UseSftpRemoteActionsOptions) {
  const { t } = useLingui();
  const [extractTarget, setExtractTarget] = useState<ExtractState>(null);
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const startTransfer = useTransfersStore((state) => state.start);
  const finishTransfer = useTransfersStore((state) => state.finish);
  async function onExtract(entry: SftpEntry) {
    if (!cwd) return;
    setExtractTarget({
      entry,
      outName: archiveStem(entry.name),
      remoteParent: cwd,
    });
  }
  function chooseExtractParent() {
    if (!extractTarget) return;
    setDirectoryPicker({
      title: t`选择解压位置`,
      initialPath: extractTarget.remoteParent,
      onSelect: (path) => {
        setDirectoryPicker(null);
        setExtractTarget((current) =>
          current
            ? {
                ...current,
                remoteParent: path,
              }
            : current,
        );
      },
    });
  }
  async function confirmExtract() {
    if (!extractTarget) return;
    const outName = extractTarget.outName.trim();
    if (!validPlainName(outName)) {
      toast.error(t`名称不能为空，且不能包含斜杠`);
      return;
    }
    setExtractTarget(null);
    await extractWithName(
      extractTarget.entry,
      extractTarget.remoteParent,
      outName,
    );
  }
  async function extractWithName(
    entry: SftpEntry,
    remoteParent: string,
    outName: string,
  ) {
    try {
      const exists = await ipc.sftpExists(
        sessionId,
        joinPath(remoteParent, outName),
      );
      if (exists) {
        showExtractConflict(entry, remoteParent, outName);
        return;
      }
    } catch (e) {
      toast.error(String(e));
      return;
    }
    await runExtract(entry, remoteParent, outName);
  }
  function showExtractConflict(
    entry: SftpEntry,
    remoteParent: string,
    outName: string,
    initialIncomingName?: string,
    initialExistingName?: string,
  ) {
    setConflict({
      name: outName,
      incomingLabel: t`解压出的文件夹`,
      initialIncomingName,
      initialExistingName,
      run: async (resolution) => {
        await resolveExtractConflict(entry, remoteParent, outName, resolution);
      },
    });
  }
  async function resolveExtractConflict(
    entry: SftpEntry,
    remoteParent: string,
    outName: string,
    { incomingName, existingName }: ConflictResolution,
  ) {
    if (existingName !== outName) {
      const targetExists = await ipc.sftpExists(
        sessionId,
        joinPath(remoteParent, existingName),
      );
      if (targetExists) {
        toast.error(t`远端已存在 “${existingName}”，请重新命名`);
        showExtractConflict(
          entry,
          remoteParent,
          outName,
          incomingName,
          existingName,
        );
        return;
      }
      await ipc.sftpRename(
        sessionId,
        joinPath(remoteParent, outName),
        joinPath(remoteParent, existingName),
      );
    }
    await extractWithName(entry, remoteParent, incomingName);
  }
  async function runExtract(
    entry: SftpEntry,
    remoteParent: string,
    outName: string,
  ) {
    const name = entry.name;
    const tid = toast.loading(t`正在解压 ${name}…`);
    setBusy(t`正在解压 ${name}…`);
    try {
      await ipc.sftpExtract(sessionId, entry.path, remoteParent, outName);
      toast.success(t`已解压到 ${outName}`, {
        id: tid,
      });
      if (cwd) await load(cwd);
    } catch (e) {
      toast.error(String(e), {
        id: tid,
      });
    } finally {
      setBusy(null);
    }
  }
  function onMove(entry: SftpEntry) {
    if (!cwd) return;
    setDirectoryPicker({
      title: t`选择移动位置`,
      initialPath: cwd,
      disabledPath: entry.isDir ? entry.path : undefined,
      onSelect: (path) => {
        setDirectoryPicker(null);
        void moveEntryTo(entry, path);
      },
    });
  }
  async function moveEntryTo(entry: SftpEntry, remoteParent: string) {
    await moveEntryWithName(entry, remoteParent, entry.name);
  }
  async function moveEntryWithName(
    entry: SftpEntry,
    remoteParent: string,
    entryName: string,
  ) {
    if (!cwd) return;
    if (entry.isDir && isSameOrChildPath(remoteParent, entry.path)) {
      toast.error(t`不能移动到自身或子文件夹中`);
      return;
    }
    const target = joinPath(remoteParent, entryName);
    if (normalizeRemotePath(target) === normalizeRemotePath(entry.path)) {
      toast.info(entry.isDir ? t`文件夹已在该位置` : t`文件已在该位置`);
      return;
    }
    try {
      const exists = await ipc.sftpExists(sessionId, target);
      if (exists) {
        showMoveConflict(entry, remoteParent, entryName);
        return;
      }
    } catch (e) {
      toast.error(String(e));
      return;
    }
    await runMoveEntry(entry, target);
  }
  function showMoveConflict(
    entry: SftpEntry,
    remoteParent: string,
    entryName: string,
    initialIncomingName?: string,
    initialExistingName?: string,
  ) {
    setConflict({
      name: entryName,
      incomingLabel: entry.isDir ? t`要移动的文件夹` : t`要移动的文件`,
      initialIncomingName,
      initialExistingName,
      run: async (resolution) => {
        await resolveMoveConflict(entry, remoteParent, entryName, resolution);
      },
    });
  }
  async function resolveMoveConflict(
    entry: SftpEntry,
    remoteParent: string,
    entryName: string,
    { incomingName, existingName }: ConflictResolution,
  ) {
    if (existingName !== entryName) {
      const renamedExistingPath = joinPath(remoteParent, existingName);
      const renamedExistingExists = await ipc.sftpExists(
        sessionId,
        renamedExistingPath,
      );
      if (renamedExistingExists) {
        toast.error(t`远端已存在 “${existingName}”，请重新命名`);
        showMoveConflict(
          entry,
          remoteParent,
          entryName,
          incomingName,
          existingName,
        );
        return;
      }
      await ipc.sftpRename(
        sessionId,
        joinPath(remoteParent, entryName),
        renamedExistingPath,
      );
    }
    await moveEntryWithName(entry, remoteParent, incomingName);
  }
  async function runMoveEntry(entry: SftpEntry, target: string) {
    if (!cwd) return;
    const name = entry.name;
    const tid = toast.loading(t`正在移动 ${name}…`);
    setBusy(t`正在移动 ${name}…`);
    try {
      await ipc.sftpRename(sessionId, entry.path, target);
      toast.success(t`已移动 ${name}`, {
        id: tid,
      });
      await load(cwd);
    } catch (e) {
      toast.error(String(e), {
        id: tid,
      });
    } finally {
      setBusy(null);
    }
  }
  async function doMkdir(name: string) {
    if (!cwd) return;
    setPrompt(null);
    try {
      await ipc.sftpMkdir(sessionId, joinPath(cwd, name));
      await load(cwd);
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function doRename(entry: SftpEntry, name: string) {
    if (!cwd || name === entry.name) {
      setPrompt(null);
      return;
    }
    setPrompt(null);
    try {
      await ipc.sftpRename(sessionId, entry.path, joinPath(cwd, name));
      await load(cwd);
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function confirmDelete() {
    const entry = deleteTarget;
    if (!entry || !cwd) return;
    setDeleteTarget(null);
    const transferId = entry.isDir ? nextTransferId() : undefined;
    const name = entry.name;
    const tid = toast.loading(t`正在删除 ${name}…`);
    setBusy(t`正在删除 ${name}…`);
    if (transferId) {
      startTransfer(transferId, t`删除 ${name}`, {
        cancellable: false,
      });
    }
    try {
      await ipc.sftpDelete(sessionId, entry.path, entry.isDir, transferId);
      if (transferId) finishTransfer(transferId, "success");
      toast.success(t`已删除 ${name}`, {
        id: tid,
      });
      await load(cwd);
    } catch (e) {
      const message = String(e);
      if (transferId) finishTransfer(transferId, "error", message);
      toast.error(message, {
        id: tid,
      });
    } finally {
      setBusy(null);
    }
  }
  return {
    extractTarget,
    setExtractTarget,
    deleteTarget,
    setDeleteTarget,
    onExtract,
    chooseExtractParent,
    confirmExtract,
    onMove,
    doMkdir,
    doRename,
    confirmDelete,
  };
}
