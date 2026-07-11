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
  paused?: boolean;
  pausedPhase?: string;
  controlPending?: boolean;
  controlError?: string;
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
  setPaused: (id: string, paused: boolean) => void;
  setControlPending: (id: string, pending: boolean) => void;
  setControlError: (id: string, error?: string) => void;
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
          paused: false,
          controlPending: false,
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

        if (item.paused) {
          return {
            ...item,
            transferred: progress.transferred,
            total: progress.total ?? null,
            speed: null,
          };
        }

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
              transferred:
                status === "success" && item.total != null
                  ? item.total
                  : item.transferred,
              error,
              speed: null,
              cancelling: false,
              paused: false,
              pausedPhase: undefined,
              controlPending: false,
              controlError: undefined,
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
              phase: "正在取消",
              cancelling: true,
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
        item.id === id ? { ...item, cancelling: false } : item,
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
            phase: "已暂停",
            speed: null,
            controlError: undefined,
            updatedAt: performance.now(),
          };
        }
        return {
          ...item,
          paused: false,
          phase: item.pausedPhase ?? "继续传输中",
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
        item.id === id ? { ...item, controlPending: pending } : item,
      ),
    }));
  },

  setControlError(id, error) {
    set((state) => ({
      transfers: state.transfers.map((item) =>
        item.id === id ? { ...item, controlError: error } : item,
      ),
    }));
  },

  clearFinished() {
    set((state) => ({
      transfers: state.transfers.filter((item) => item.status === "running"),
    }));
  },
}));
