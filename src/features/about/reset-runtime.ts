import { isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { AppDataResetFailure, AppDataResetProgress } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { appDataResetStatus } from "~/lib/ipc";
import { clearQueryData } from "~/lib/query-client";
import type { AppError } from "~/types";

import { resetApplicationData } from "./reset-app-data";

interface ResetState {
  phase: "checking" | "idle" | "running" | "pending" | "failed" | "finished";
  progress: AppDataResetProgress | null;
  failures: AppDataResetFailure[];
  errors: AppError[];
  canReturn: boolean;
}

export const useResetStore = create<ResetState>(() => ({
  phase: isTauri() ? "checking" : "idle",
  progress: null,
  failures: [],
  errors: [],
  canReturn: false,
}));
let task: Promise<void> | null = null;

function exclusive(action: () => Promise<void>) {
  if (task) return task;
  task = action().finally(() => {
    task = null;
  });
  return task;
}

export function inspectReset() {
  return exclusive(async () => {
    if (!isTauri()) {
      useResetStore.setState({ phase: "idle" });
      return;
    }
    const hadReset = useResetStore.getState().progress !== null;
    clearQueryData();
    useResetStore.setState({ phase: "checking", canReturn: false });
    try {
      const progress = await appDataResetStatus();
      if (!progress && hadReset) {
        // 完成确认的响应可能丢失；此时不能重新挂载重置前的内存状态。
        useResetStore.setState({ phase: "finished", errors: [], failures: [] });
        window.location.assign("/");
        return;
      }
      useResetStore.setState({
        phase: progress ? "pending" : "idle",
        progress,
        errors: [],
        failures: [],
      });
    } catch (cause) {
      useResetStore.setState({
        phase: "failed",
        errors: [toIpcError(cause).payload],
      });
    }
  });
}

export function startReset(resume = false) {
  return exclusive(async () => {
    const id = resume ? useResetStore.getState().progress?.id : undefined;
    if (resume && !id) return;
    clearQueryData();
    useResetStore.setState({
      phase: "running",
      errors: [],
      failures: [],
      canReturn: false,
    });
    try {
      const { result, warnings, finished } = await resetApplicationData(
        localStorage,
        id,
      );
      useResetStore.setState({
        phase: finished ? "finished" : "pending",
        progress: result.progress,
        failures: result.failures,
        errors: warnings,
      });
      if (finished && !warnings.length) window.location.assign("/");
    } catch (cause) {
      // 请求失败可能发生在主库提交之后，必须读取持久记录确认实际进度。
      const errors = [toIpcError(cause).payload];
      try {
        const progress = await appDataResetStatus();
        useResetStore.setState({
          phase: !progress && id ? "finished" : "failed",
          progress,
          errors,
          canReturn: !progress && !id,
        });
      } catch (readError) {
        errors.push(toIpcError(readError).payload);
        useResetStore.setState({ phase: "failed", errors, canReturn: false });
      }
    } finally {
      // 根边界卸载期间的晚到回调也必须清除，拒绝重置返回时重新读取。
      clearQueryData();
    }
  });
}

export function returnFromRejectedReset() {
  if (!task && useResetStore.getState().canReturn)
    useResetStore.setState({ phase: "idle" });
}
