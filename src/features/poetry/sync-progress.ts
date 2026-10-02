import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { AppError, PoetrySyncProgress } from "~/types";
import {
  createSubscription,
  type Subscription,
} from "~/lib/event-subscription";
import { LIBRARY_SYNC_PROGRESS } from "~/lib/events";

/**
 * 诗词库同步进度的共享快照。
 *
 * 之前每个调用者各自订阅事件、各自起 30 秒定时器，并且把「静默」当成
 * 任务结束（回到 IDLE）——但缺少新进度并不等于任务停止。现在由模块运行期
 * 安装一个监听，所有消费者读同一份快照，静默只标记为「等待确认」。
 */
const SILENCE_MS = 30_000;

export interface PoetrySyncProgressState {
  active: boolean;
  /** 超过静默窗口没有新进度：任务可能仍在跑，等待确认而非当作已结束。 */
  stale: boolean;
  collectionId: string | null;
  /** 阶段取值：downloading / verifying / importing / indexing / done / error */
  phase: string | null;
  bytesDone: number;
  bytesTotal: number | null;
  imported: number;
  /** 当前导入阶段已知的合计总数，上报时存在。 */
  total: number | null;
  /** 仅在终态 `error` 阶段设置的完整协议错误，渲染时再本地化。 */
  error: AppError | null;
  updatedAt: number;
}

const INITIAL: PoetrySyncProgressState = {
  active: false,
  stale: false,
  collectionId: null,
  phase: null,
  bytesDone: 0,
  bytesTotal: null,
  imported: 0,
  total: null,
  error: null,
  updatedAt: 0,
};

interface PoetrySyncStore {
  progress: PoetrySyncProgressState;
}

export const usePoetrySyncStore = create<PoetrySyncStore>(() => ({
  progress: INITIAL,
}));

let installed = false;
let subscription: Subscription | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;

function clearSilence(): void {
  if (silenceTimer !== null) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

function markStale(): void {
  silenceTimer = null;
  const current = usePoetrySyncStore.getState().progress;
  // 只标记「待确认」：既不结束任务，也不清空最后一次进度。
  if (!current.active || current.stale) return;
  usePoetrySyncStore.setState({ progress: { ...current, stale: true } });
}

function applyProgress(payload: PoetrySyncProgress): void {
  const terminal = payload.phase === "done" || payload.phase === "error";
  clearSilence();
  usePoetrySyncStore.setState({
    progress: {
      active: !terminal,
      stale: false,
      collectionId: payload.collectionId,
      phase: payload.phase,
      bytesDone: payload.bytesDone,
      bytesTotal: payload.bytesTotal,
      imported: payload.imported,
      total: payload.total,
      error: payload.error ?? null,
      updatedAt: Date.now(),
    },
  });
  if (!terminal) silenceTimer = setTimeout(markStale, SILENCE_MS);
}

export function installPoetrySyncRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  subscription = createSubscription(() =>
    listen<PoetrySyncProgress>(LIBRARY_SYNC_PROGRESS, (event) =>
      applyProgress(event.payload),
    ),
  );
  return () => {
    installed = false;
    clearSilence();
    subscription?.dispose();
    subscription = null;
    usePoetrySyncStore.setState({ progress: INITIAL });
  };
}

/** 读取共享快照；不再为每个调用者单独订阅事件。 */
export function usePoetrySyncProgress(): PoetrySyncProgressState {
  return usePoetrySyncStore((state) => state.progress);
}
