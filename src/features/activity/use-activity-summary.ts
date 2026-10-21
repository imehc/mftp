import { usePoetrySyncStore } from "~/features/poetry/sync-progress";
import { useUpdaterActivitySummary } from "~/features/updater/integration";
import { hasCustomCode } from "~/lib/errors";
import { useTransfersStore } from "~/store/transfers";

import { summarizeActivity } from "./activity-summary";
import { useActivityExecutionLogs } from "./ActivityProvider";

export function useActivitySummary() {
  const transferFailed = useTransfersStore(
    (state) => state.transfers.filter((item) => item.status === "error").length,
  );
  const transferRunning = useTransfersStore(
    (state) =>
      state.transfers.filter((item) => item.status === "running").length,
  );
  const syncActive = usePoetrySyncStore((state) => state.progress.active);
  const syncPhase = usePoetrySyncStore((state) => state.progress.phase);
  const syncError = usePoetrySyncStore((state) => state.progress.error);
  const updater = useUpdaterActivitySummary();
  const logs = useActivityExecutionLogs();
  return summarizeActivity({
    transferFailed,
    transferRunning,
    poetrySync: {
      active: syncActive,
      phase: syncPhase,
      cancelled: hasCustomCode(syncError, "poetry:sync_cancelled"),
    },
    updater,
    latestLogStatus: logs.operations.at(-1)?.status ?? null,
  });
}
