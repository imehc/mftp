import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { DISK_CLEAN_PROGRESS } from "~/lib/events";
import * as ipc from "~/lib/ipc";
import type { ScanProgress } from "~/types";
import { useDiskCleanStore } from "./store";

/** Progress arrives every 120ms from Rust; coalesce to one render per frame. */
const FLUSH_MS = 100;

/**
 * Owns the scan lifecycle: rule catalog, volume stat, the progress
 * subscription, and start/cancel.
 *
 * The backend throttles `disk-clean://progress` to 120ms, but a terminal event
 * can still be missed if it lands while the listener is being torn down and
 * re-attached. Every terminal phase therefore also polls `disk_clean_job` for
 * the authoritative result rather than trusting the event alone.
 */
export function useDiskScan() {
  const { t } = useLingui();
  const store = useDiskCleanStore;
  const startJob = useDiskCleanStore((s) => s.startJob);
  const applyProgress = useDiskCleanStore((s) => s.applyProgress);
  const finishJob = useDiskCleanStore((s) => s.finishJob);
  const failJob = useDiskCleanStore((s) => s.failJob);
  const setRules = useDiskCleanStore((s) => s.setRules);
  const setVolume = useDiskCleanStore((s) => s.setVolume);

  // Read inside callbacks rather than subscribing, so a changing job id does
  // not re-run the listener effect and drop events mid-scan.
  const jobIdRef = useRef<string | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const [rules, volume] = await Promise.all([
        ipc.diskCleanRules(),
        ipc.diskCleanVolume(),
      ]);
      setRules(rules);
      setVolume(volume);
    } catch (e) {
      toast.error(String(e));
    }
  }, [setRules, setVolume]);

  /** Pull the finished job's payload; the event carries counters, not items. */
  const settle = useCallback(
    async (jobId: string) => {
      try {
        const job = await ipc.diskCleanJob(jobId);
        // Still working — leave the live counters alone.
        if (job.phase === "expanding" || job.phase === "running") return;
        if (job.phase === "completed" && job.result) {
          finishJob(job.result.items, {
            scannedFiles: job.result.scannedFiles,
            scannedDirs: job.result.scannedDirs,
            totalBytes: job.result.totalBytes,
            skipped: job.result.skipped,
          });
        } else {
          failJob(job.phase, job.error);
          if (job.error) toast.error(job.error);
        }
      } catch (e) {
        failJob("failed", String(e));
        toast.error(String(e));
      }
    },
    [failJob, finishJob],
  );

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pending: ScanProgress | null = null;

    const flush = () => {
      flushTimer = null;
      if (!pending) return;
      const progress = pending;
      pending = null;
      applyProgress(progress);
    };

    void listen<ScanProgress>(DISK_CLEAN_PROGRESS, (event) => {
      const progress = event.payload;
      // Only the newest sample matters — unlike transfers there is one job at
      // a time, so replace rather than accumulate.
      pending = progress;
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);

      if (progress.phase !== "expanding" && progress.phase !== "running") {
        // Terminal: apply immediately so the UI never shows a stale running
        // bar, then fetch the authoritative result.
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        pending = null;
        applyProgress(progress);
        if (progress.jobId === jobIdRef.current) void settle(progress.jobId);
      }
    }).then((unlisten) => {
      // The effect can unmount before this promise resolves; detach at once.
      if (cancelled) unlisten();
      else dispose = unlisten;
    });

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      pending = null;
      dispose?.();
    };
  }, [applyProgress, settle]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Polling fallback. A scan that matches nothing reaches its terminal phase
  // before `disk_clean_scan` resolves, so the event handler has no job id yet
  // and `settle` never fires — without this the UI would sit on "expanding"
  // forever. Also covers any event dropped during listener re-attach.
  const livePhase = useDiskCleanStore((s) => s.phase);
  const liveJobId = useDiskCleanStore((s) => s.jobId);
  useEffect(() => {
    if (!liveJobId) return;
    if (livePhase !== "expanding" && livePhase !== "running") return;
    const timer = setInterval(() => {
      void settle(liveJobId);
    }, 1500);
    return () => clearInterval(timer);
  }, [livePhase, liveJobId, settle]);

  const start = useCallback(async () => {
    const selected = Array.from(store.getState().selectedRules);
    if (selected.length === 0) {
      toast.error(t`请先选择要清理的项目`);
      return;
    }
    try {
      const jobId = await ipc.diskCleanScan(selected);
      jobIdRef.current = jobId;
      startJob(jobId);
    } catch (e) {
      toast.error(String(e));
    }
  }, [startJob, store, t]);

  const cancel = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      await ipc.diskCleanCancel(jobId);
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  return { start, cancel, refresh: loadCatalog };
}
