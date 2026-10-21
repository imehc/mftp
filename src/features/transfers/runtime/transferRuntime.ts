import { listen } from "@tauri-apps/api/event";

import { createBackoffScheduler } from "~/lib/backoff-scheduler";
import { toIpcError } from "~/lib/errors";
import {
  createSubscription,
  type Subscription,
} from "~/lib/event-subscription";
import { TRANSFER_PROGRESS } from "~/lib/events";
import { useTransfersStore } from "~/store/transfers";
import type { TransferProgress } from "~/types";

const FLUSH_MS = 100;

/**
 * 传输进度运行期。
 *
 * 进度事件原先由传输底栏自己监听：底栏没挂载（例如停留在设置页）
 * 时进度就丢了，回到首页只能等下一次事件。这里把监听收到应用运行期，
 * 活动中心只负责展示。
 */

let installed = false;
let subscription: Subscription | null = null;
let reconnect: ReturnType<typeof createBackoffScheduler> | null = null;
let pending = new Map<string, TransferProgress>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  if (pending.size === 0) return;
  const updates = [...pending.values()];
  pending = new Map();
  useTransfersStore.getState().updateProgressBatch(updates);
}

function installSubscription(): void {
  if (!installed) return;
  subscription?.dispose();
  let failed = false;
  const next = createSubscription(
    () =>
      listen<TransferProgress>(TRANSFER_PROGRESS, (event) => {
        // 同一任务只保留最新一条，按 100ms 合并写入，避免高频 setState。
        pending.set(event.payload.id, event.payload);
        if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_MS);
      }),
    {
      onError: (cause) => {
        failed = true;
        useTransfersStore.getState().setRuntimeError(toIpcError(cause));
        reconnect?.schedule();
      },
    },
  );
  subscription = next;
  void next.ready.then(() => {
    if (subscription !== next || failed) return;
    reconnect?.reset();
    if (useTransfersStore.getState().runtimeError) {
      useTransfersStore.getState().setRuntimeError(null);
    }
  });
}

/** 订阅失败后由面板触发的立即重连。 */
export function retryTransferRuntime(): void {
  if (!installed) return;
  reconnect?.reset();
  installSubscription();
}

export function installTransferRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  reconnect = createBackoffScheduler(installSubscription, {
    baseMs: 1000,
    maxMs: 30000,
  });
  installSubscription();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    installed = false;
    reconnect?.stop();
    reconnect = null;
    subscription?.dispose();
    subscription = null;
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = new Map();
  };
}
