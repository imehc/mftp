import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import type {
  RsyncIntegration,
  RsyncSyncRequest,
  UseRsyncIntegrationOptions,
} from "~/features/ssh-sftp/components/sftp/rsync-contract";
import { nextTransferId } from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { runSftpWrite } from "~/features/ssh-sftp/queries";
import { hasCustomCode, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { useSessionsStore } from "~/store/sessions";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

import {
  forgetRsyncCapabilities,
  loadRsyncCapabilities,
  useRsyncCapability,
} from "./capability-store";
import RsyncCapabilityNotice from "./RsyncCapabilityNotice";
import RsyncSyncDialog, { type RsyncPreviewState } from "./RsyncSyncDialog";

interface PreviewRequest extends RsyncSyncRequest {
  deleteExtraneous: boolean;
}

// 预览返回这些错误说明能力状态变了；刷新后内容区的安装提示才准确。
const CAPABILITY_CODES = new Set([
  "rsync:local_missing",
  "rsync:local_unsupported",
  "rsync:remote_missing",
  "rsync:remote_unsupported",
  "rsync:probe_failed",
  "rsync:probe_timeout",
]);

export function useRsyncIntegration({
  sessionId,
  onUploaded,
}: UseRsyncIntegrationOptions): RsyncIntegration {
  const { t } = useLingui();
  const active = useSettingsStore(
    (state) => state.directoryTransferMode === "rsync",
  );
  const capability = useRsyncCapability(sessionId);
  const startTransfer = useTransfersStore((state) => state.start);
  const finishTransfer = useTransfersStore((state) => state.finish);
  const [previewState, setPreviewState] = useState<RsyncPreviewState | null>(
    null,
  );
  // 递增后，晚到的预览结果不再写回已关闭或已被取代的弹窗。
  const generation = useRef(0);

  useEffect(() => {
    if (active) void loadRsyncCapabilities(sessionId);
    return () => {
      generation.current += 1;
      const open = useSessionsStore
        .getState()
        .sessions.some((item) => item.id === sessionId);
      if (!open) forgetRsyncCapabilities(sessionId);
    };
  }, [active, sessionId]);

  async function runPreview(request: PreviewRequest): Promise<void> {
    const current = ++generation.current;
    const requestId = String(current);
    setPreviewState({
      requestId,
      direction: request.direction,
      localDir: request.localDir,
      remoteDir: request.remoteDir,
      displayName: request.displayName,
      deleteExtraneous: request.deleteExtraneous,
      preview: null,
      loading: true,
      error: null,
    });
    // 预览依赖后端缓存的能力结果；先刷新，安装 rsync 后无需重连。
    await loadRsyncCapabilities(sessionId, true);
    if (generation.current !== current) return;
    try {
      const preview = await ipc.rsyncPreview(
        sessionId,
        request.direction,
        request.localDir,
        request.remoteDir,
        request.deleteExtraneous,
      );
      if (generation.current !== current) return;
      setPreviewState((state) =>
        state?.requestId === requestId
          ? { ...state, preview, loading: false, error: null }
          : state,
      );
    } catch (error) {
      if (generation.current !== current) return;
      const payload = toIpcError(error).payload;
      setPreviewState((state) =>
        state?.requestId === requestId
          ? { ...state, loading: false, error: payload }
          : state,
      );
      if (CAPABILITY_CODES.has(payload.code))
        void loadRsyncCapabilities(sessionId, true);
    }
  }

  function startPreview(request: RsyncSyncRequest): Promise<void> {
    if (!active) return Promise.resolve();
    return runPreview({
      ...request,
      // 新建操作固定当前删除偏好；弹窗内重试沿用同一份快照。
      deleteExtraneous: useSettingsStore.getState().rsyncDeleteExtraneous,
    });
  }

  function closePreview(): void {
    generation.current += 1;
    setPreviewState(null);
  }

  function retryPreview(): void {
    if (!previewState || previewState.loading) return;
    void runPreview({
      direction: previewState.direction,
      localDir: previewState.localDir,
      remoteDir: previewState.remoteDir,
      displayName: previewState.displayName,
      deleteExtraneous: previewState.deleteExtraneous,
    });
  }

  async function confirmPreview(): Promise<void> {
    const state = previewState;
    if (!state?.preview || state.loading) return;
    const token = state.preview.token;
    generation.current += 1;
    setPreviewState(null);
    const transferId = nextTransferId();
    const displayName = state.displayName;
    const label =
      state.direction === "upload"
        ? t`上传 ${displayName}`
        : t`下载 ${displayName}`;
    startTransfer(transferId, label, {
      pausable: false,
      kind: state.direction === "upload" ? "upload" : "download",
    });
    try {
      const transfer = () =>
        ipc.rsyncTransfer(
          sessionId,
          token,
          state.direction,
          state.localDir,
          state.remoteDir,
          state.deleteExtraneous,
          transferId,
        );
      if (state.direction === "upload") await runSftpWrite(sessionId, transfer);
      else await transfer();
      finishTransfer(transferId, "success");
    } catch (error) {
      finishTransfer(
        transferId,
        hasCustomCode(error, "sftp:transfer_cancelled") ? "cancelled" : "error",
        error,
      );
      return;
    }
    if (state.direction === "upload") await onUploaded();
  }

  const notice = active ? (
    <RsyncCapabilityNotice
      capabilities={capability.capabilities}
      loading={capability.loading}
      error={capability.error}
      onRefresh={() => void loadRsyncCapabilities(sessionId, true)}
    />
  ) : null;

  const dialog = (
    <RsyncSyncDialog
      state={previewState}
      onOpenChange={(open) => {
        if (!open) closePreview();
      }}
      onRetry={retryPreview}
      onConfirm={() => void confirmPreview()}
    />
  );

  return {
    supported: true,
    active,
    startPreview,
    notice,
    dialog,
  };
}
