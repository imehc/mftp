import { create } from "zustand";
import { msg } from "@lingui/core/macro";
import { translate } from "~/i18n/translate";
import type { TransferProgress } from "~/types";

/** 后端 BT phase 是机器 key，文案归前端；未收录的 key 原样透出。 */
const BT_PHASE_LABELS: Record<string, () => string> = {
  "bt:metadata": () => translate(msg`获取资源信息…`),
  "bt:downloading": () => translate(msg`下载中`),
  "bt:seeding": () => translate(msg`做种中`),
  "bt:paused": () => translate(msg`已暂停`),
  "bt:error": () => translate(msg`错误`),
  "bt:packaging": () => translate(msg`打包中`),
};

function btPhaseLabel(phase: string): string {
  return BT_PHASE_LABELS[phase]?.() ?? phase;
}
export interface TransferState {
  id: string;
  label: string;
  phase: string;
  transferred: number;
  total?: number | null;
  speed?: number | null;
  updatedAt: number;
  status: "running" | "success" | "error" | "cancelled";
  error?: string;
  cancelling?: boolean;
  cancellingPhase?: string;
  cancellable?: boolean;
  paused?: boolean;
  pausedPhase?: string;
  controlPending?: boolean;
  controlError?: string;
  retry?: () => void | Promise<void>;
  retrying?: boolean;
  /** 面板徽标展示的任务来源；默认为 sftp（历史行为）。 */
  source?: "sftp" | "bt";
  /** BT 任务模式；preview = 缓存下载，支撑在线播放。 */
  mode?: "download" | "preview";
}
interface TransfersState {
  transfers: TransferState[];
  dismissed: Set<string>;
  start: (
    id: string,
    label: string,
    options?: {
      cancellable?: boolean;
      retry?: () => void | Promise<void>;
      source?: "sftp" | "bt";
      mode?: "download" | "preview";
    },
  ) => void;
  restore: TransfersState["start"];
  dismiss: (id: string) => void;
  updateProgressBatch: (progresses: TransferProgress[]) => void;
  finish: (
    id: string,
    status: "success" | "error" | "cancelled",
    error?: string,
  ) => void;
  markCancelling: (id: string) => void;
  cancelFailed: (id: string) => void;
  setPaused: (id: string, paused: boolean) => void;
  setControlPending: (id: string, pending: boolean) => void;
  setControlError: (id: string, error?: string) => void;
  setRetrying: (id: string, retrying: boolean) => void;
  clearFinished: () => void;
}
export const useTransfersStore = create<TransfersState>((set) => ({
  transfers: [],
  dismissed: new Set(),
  start(id, label, options) {
    set((state) => {
      const dismissed = new Set(state.dismissed);
      dismissed.delete(id);
      return {
        dismissed,
        transfers: [
          createTransfer(id, label, options),
          ...state.transfers.filter((item) => item.id !== id),
        ],
      };
    });
  },
  restore(id, label, options) {
    set((state) => {
      if (state.dismissed.has(id)) return state;
      return {
        transfers: [
          createTransfer(id, label, options),
          ...state.transfers.filter((item) => item.id !== id),
        ],
      };
    });
  },
  dismiss(id) {
    set((state) => {
      const dismissed = new Set(state.dismissed);
      dismissed.add(id);
      return {
        dismissed,
        transfers: state.transfers.filter((item) => item.id !== id),
      };
    });
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

        // 引擎托管的任务（BT）：后端 finished 标志会直接把任务标记为 success。
        if (progress.finished === true) {
          return {
            ...item,
            status: "success" as const,
            phase: translate(msg`完成`),
            transferred: progress.total ?? progress.transferred,
            total: progress.total ?? null,
            speed: null,
            cancelling: false,
            paused: false,
            pausedPhase: undefined,
            updatedAt: now,
          };
        }
        if (item.paused) {
          return {
            ...item,
            transferred: progress.transferred,
            total: progress.total ?? null,
            speed: null,
          };
        }
        const phase =
          item.source === "bt" ? btPhaseLabel(progress.phase) : progress.phase;
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
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
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
              error,
              speed: null,
              cancelling: false,
              cancellingPhase: undefined,
              paused: false,
              pausedPhase: undefined,
              controlPending: false,
              controlError: undefined,
              retry: status === "error" ? item.retry : undefined,
              retrying: false,
              updatedAt: performance.now(),
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
              cancellingPhase: item.source === "bt" ? item.phase : undefined,
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
              phase:
                item.source === "bt" && item.cancellingPhase
                  ? item.cancellingPhase
                  : item.phase,
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
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id
          ? {
              ...item,
              controlError: error,
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
  clearFinished() {
    set((state) => {
      const dismissed = new Set(state.dismissed);
      for (const item of state.transfers) {
        if (item.status !== "running") dismissed.add(item.id);
      }
      return {
        dismissed,
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
    transferred: 0,
    total: null,
    speed: null,
    updatedAt: performance.now(),
    status: "running",
    cancellable: options?.cancellable ?? true,
    paused: false,
    controlPending: false,
    controlError: undefined,
    retry: options?.retry,
    source: options?.source,
    mode: options?.mode,
    retrying: false,
  };
}
