import { msg } from "@lingui/core/macro";
import { create } from "zustand";

import type { TransferRetryIntent } from "~/features/transfers/retry";
import { translate } from "~/i18n/translate";
import { toIpcError } from "~/lib/errors";
import type { AppError, TransferProgress } from "~/types";

/**
 * 传输任务的来源动作。
 *
 * 传输坞按此选择图标与动效，不从 label 文案反推——文案会随语言和措辞变化。
 */
export type TransferKind = "upload" | "download" | "sync" | "delete" | "other";

export interface TransferState {
  id: string;
  label: string;
  phase: string;
  /** 决定坞内图标与动效；未声明时使用通用图标。 */
  kind: TransferKind;
  /** 任务创建时刻（performance.now 基准），用于最小可见时长。 */
  startedAt: number;
  /** 结束时刻；运行中为空。 */
  finishedAt?: number;
  transferred: number;
  total?: number | null;
  speed?: number | null;
  updatedAt: number;
  status: "running" | "success" | "error" | "cancelled";
  error?: AppError;
  cancelling?: boolean;
  cancellingPhase?: string;
  cancellable?: boolean;
  /** rsync 首版只支持取消；false 时任务面板不提供暂停。 */
  pausable?: boolean;
  paused?: boolean;
  pausedPhase?: string;
  controlPending?: boolean;
  controlError?: AppError;
  /** 重试动作的类型化描述；不能保存页面的 setState 闭包。 */
  retry?: TransferRetryIntent;
  retrying?: boolean;
}

interface TransfersState {
  transfers: TransferState[];
  /** 进度事件监听不可用；面板据此提示，不把失败当成“没有任务”。 */
  runtimeError?: AppError;
  start: (
    id: string,
    label: string,
    options?: {
      cancellable?: boolean;
      pausable?: boolean;
      retry?: TransferRetryIntent;
      kind?: TransferKind;
    },
  ) => void;
  dismiss: (id: string) => void;
  updateProgressBatch: (progresses: TransferProgress[]) => void;
  finish: (
    id: string,
    status: "success" | "error" | "cancelled",
    error?: unknown,
  ) => void;
  markCancelling: (id: string) => void;
  cancelFailed: (id: string) => void;
  setPaused: (id: string, paused: boolean) => void;
  setControlPending: (id: string, pending: boolean) => void;
  setControlError: (id: string, error?: unknown) => void;
  setRetrying: (id: string, retrying: boolean) => void;
  setRuntimeError: (error?: unknown) => void;
  clearFinished: () => void;
}

export const useTransfersStore = create<TransfersState>((set) => ({
  transfers: [],
  runtimeError: undefined,
  start(id, label, options) {
    set((state) => ({
      transfers: [
        createTransfer(id, label, options),
        ...state.transfers.filter((item) => item.id !== id),
      ],
    }));
  },
  dismiss(id) {
    set((state) => ({
      transfers: state.transfers.filter((item) => item.id !== id),
    }));
  },
  updateProgressBatch(progresses) {
    if (progresses.length === 0) return;
    const now = performance.now();
    const progressById = new Map(
      progresses.map((progress) => [progress.id, progress]),
    );
    set((state) => ({
      transfers: state.transfers.map((item) => {
        const progress = progressById.get(item.id);
        if (!progress || item.status !== "running") return item;

        if (item.paused) {
          return {
            ...item,
            transferred: progress.transferred,
            total: progress.total ?? null,
            speed: null,
          };
        }
        const phase = progress.phase;
        const phaseChanged = phase !== item.phase;
        return {
          ...item,
          phase,
          transferred: progress.transferred,
          total: progress.total ?? null,
          speed:
            !phaseChanged &&
            now > item.updatedAt &&
            progress.transferred >= item.transferred
              ? ((progress.transferred - item.transferred) /
                  (now - item.updatedAt)) *
                1000
              : null,
          updatedAt: now,
        };
      }),
    }));
  },
  finish(id, status, error) {
    // 旧调用方的字符串在公共边界兼容，任务状态只保存完整协议。
    const payload =
      status === "error" && error != null
        ? toIpcError(error).payload
        : undefined;
    const now = performance.now();
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              finishedAt: now,
              phase:
                status === "success"
                  ? translate(msg`完成`)
                  : status === "cancelled"
                    ? translate(msg`已取消`)
                    : translate(msg`失败`),
              transferred:
                status === "success" && item.total != null
                  ? item.total
                  : item.transferred,
              error: payload,
              speed: null,
              cancelling: false,
              cancellingPhase: undefined,
              paused: false,
              pausedPhase: undefined,
              controlPending: false,
              controlError: undefined,
              retry: status === "error" ? item.retry : undefined,
              retrying: false,
              updatedAt: now,
            }
          : item,
      ),
    }));
  },
  markCancelling(id) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              phase: translate(msg`正在取消`),
              cancelling: true,
              cancellingPhase: item.phase,
              paused: false,
              pausedPhase: undefined,
              speed: null,
              controlError: undefined,
            }
          : item,
      ),
    }));
  },
  cancelFailed(id) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              phase: item.cancellingPhase ?? item.phase,
              cancelling: false,
              cancellingPhase: undefined,
            }
          : item,
      ),
    }));
  },
  setPaused(id, paused) {
    set((state) => ({
      transfers: state.transfers.map((item) => {
        if (item.id !== id || item.status !== "running") return item;
        if (paused) {
          return {
            ...item,
            paused: true,
            pausedPhase: item.phase,
            phase: translate(msg`已暂停`),
            speed: null,
            controlError: undefined,
            updatedAt: performance.now(),
          };
        }
        return {
          ...item,
          paused: false,
          phase: item.pausedPhase ?? translate(msg`继续传输中`),
          pausedPhase: undefined,
          speed: null,
          controlError: undefined,
          updatedAt: performance.now(),
        };
      }),
    }));
  },
  setControlPending(id, pending) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              controlPending: pending,
            }
          : item,
      ),
    }));
  },
  setControlError(id, error) {
    const payload = error == null ? undefined : toIpcError(error).payload;
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              controlError: payload,
            }
          : item,
      ),
    }));
  },
  setRetrying(id, retrying) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              retrying,
            }
          : item,
      ),
    }));
  },
  setRuntimeError(error) {
    set({
      runtimeError: error == null ? undefined : toIpcError(error).payload,
    });
  },
  clearFinished() {
    set((state) => {
      return {
        transfers: state.transfers.filter((item) => item.status === "running"),
      };
    });
  },
}));

function createTransfer(
  id: string,
  label: string,
  options?: Parameters<TransfersState["start"]>[2],
): TransferState {
  return {
    id,
    label,
    phase: translate(msg`准备中`),
    kind: options?.kind ?? "other",
    startedAt: performance.now(),
    finishedAt: undefined,
    transferred: 0,
    total: null,
    speed: null,
    updatedAt: performance.now(),
    status: "running",
    cancellable: options?.cancellable ?? true,
    pausable: options?.pausable ?? true,
    paused: false,
    controlPending: false,
    controlError: undefined,
    retry: options?.retry,
    retrying: false,
  };
}
