import { create } from "zustand";
import type { TransferProgress } from "~/types";

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
  cancellable?: boolean;
}

interface TransfersState {
  transfers: TransferState[];
  start: (
    id: string,
    label: string,
    options?: { cancellable?: boolean },
  ) => void;
  updateProgressBatch: (progresses: TransferProgress[]) => void;
  finish: (
    id: string,
    status: "success" | "error" | "cancelled",
    error?: string,
  ) => void;
  markCancelling: (id: string) => void;
  cancelFailed: (id: string) => void;
  clearFinished: () => void;
}

export const useTransfersStore = create<TransfersState>((set) => ({
  transfers: [],

  start(id, label, options) {
    set((state) => ({
      transfers: [
        {
          id,
          label,
          phase: "准备中",
          transferred: 0,
          total: null,
          speed: null,
          updatedAt: performance.now(),
          status: "running",
          cancellable: options?.cancellable ?? true,
        },
        ...state.transfers.filter((item) => item.id !== id),
      ],
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

        const phaseChanged = progress.phase !== item.phase;
        return {
          ...item,
          phase: progress.phase,
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
                  ? "完成"
                  : status === "cancelled"
                    ? "已取消"
                    : "失败",
              error,
              speed: null,
              cancelling: false,
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
          ? { ...item, phase: "正在取消", cancelling: true, speed: null }
          : item,
      ),
    }));
  },

  cancelFailed(id) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id ? { ...item, cancelling: false } : item,
      ),
    }));
  },

  clearFinished() {
    set((state) => ({
      transfers: state.transfers.filter((item) => item.status === "running"),
    }));
  },
}));
