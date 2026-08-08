import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { DISK_CLEAN_PROGRESS } from "~/lib/events";
import * as ipc from "~/lib/ipc";
import type { ScanPhase, ScanProgress, TreeNode } from "~/types";

/** Depth the backend walks per analyze job; it clamps to 1..12 anyway. */
const ANALYZE_DEPTH = 6;

/**
 * Arbitrary-directory analysis: pick a folder, walk it, drill into the tree.
 *
 * Kept separate from `useDiskScan` because the two share only the progress
 * event name. A rule scan produces a flat deletable list; analyze produces a
 * read-only tree and never feeds the remove gate.
 */
export function useDiskAnalyze() {
  const { t } = useLingui();
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [phase, setPhase] = useState<ScanPhase | null>(null);
  /** Drill path; index 0 is the analyzed root. */
  const [stack, setStack] = useState<TreeNode[]>([]);
  const jobIdRef = useRef<string | null>(null);

  const settle = useCallback(async (jobId: string) => {
    try {
      const job = await ipc.diskCleanJob(jobId);
      if (job.phase === "expanding" || job.phase === "running") return;
      setPhase(job.phase);
      if (job.phase === "completed" && job.tree) {
        setRoot(job.tree);
        setStack([job.tree]);
      } else if (job.error) {
        toast.error(job.error);
      }
    } catch (e) {
      setPhase("failed");
      toast.error(String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;

    void listen<ScanProgress>(DISK_CLEAN_PROGRESS, (event) => {
      const progress = event.payload;
      if (progress.jobId !== jobIdRef.current) return;
      setPhase(progress.phase);
      if (progress.phase !== "expanding" && progress.phase !== "running") {
        void settle(progress.jobId);
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [settle]);

  // Polling fallback, same reasoning as useDiskScan: a shallow directory can
  // finish before `disk_clean_analyze` resolves, leaving no job id for the
  // event handler to match.
  useEffect(() => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    if (phase !== "expanding" && phase !== "running") return;
    const timer = setInterval(() => {
      void settle(jobId);
    }, 1500);
    return () => clearInterval(timer);
  }, [phase, settle]);

  const pickAndAnalyze = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: true,
      title: t`选择要分析的目录`,
    });
    if (typeof selected !== "string" || !selected) return;

    try {
      setRoot(null);
      setStack([]);
      setPhase("running");
      const jobId = await ipc.diskCleanAnalyze(selected, ANALYZE_DEPTH);
      jobIdRef.current = jobId;
    } catch (e) {
      setPhase("failed");
      toast.error(String(e));
    }
  }, [t]);

  const drill = useCallback((child: TreeNode) => {
    setStack((prev) => [...prev, child]);
  }, []);

  /** Jump back to a level in the breadcrumb; index 0 is the root. */
  const drillTo = useCallback((index: number) => {
    setStack((prev) => prev.slice(0, index + 1));
  }, []);

  const cancel = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      await ipc.diskCleanCancel(jobId);
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  const clear = useCallback(() => {
    jobIdRef.current = null;
    setRoot(null);
    setStack([]);
    setPhase(null);
  }, []);

  return {
    root,
    phase,
    stack,
    current: stack[stack.length - 1] ?? null,
    pickAndAnalyze,
    drill,
    drillTo,
    cancel,
    clear,
  };
}
