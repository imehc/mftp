import { listen } from "@tauri-apps/api/event";

import { toIpcError } from "~/lib/errors";
import {
  createSubscription,
  type Subscription,
} from "~/lib/event-subscription";
import { TRANSFER_PROGRESS } from "~/lib/events";
import { useTransfersStore } from "~/store/transfers";
import type { TransferProgress } from "~/types";

const FLUSH_MS = 100;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * 传输进度运行期。
 *
 * 进度事件原先由 `TransferPanel` 自己监听：面板没挂载（例如停留在设置页）
 * 时进度就丢了，回到首页只能等下一次事件。这里把监听收到应用运行期，
 * 面板只负责展示。
 */

let installed = false;
let subscription: Subscription | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pending = new Map<string, TransferProgress>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  if (pending.size === 0) return;
  const updates = [...pending.values()];
  pending = new Map();
  useTransfersStore.getState().updateProgressBatch(updates);
}

function clearReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnect();
  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** reconnectAttempt,
    RECONNECT_MAX_MS,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    installSubscription();
  }, delay);
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
        scheduleReconnect();
      },
    },
  );
  subscription = next;
  void next.ready.then(() => {
    if (subscription !== next || failed) return;
    reconnectAttempt = 0;
    if (useTransfersStore.getState().runtimeError) {
      useTransfersStore.getState().setRuntimeError(null);
    }
  });
}

/** 订阅失败后由面板触发的立即重连。 */
export function retryTransferRuntime(): void {
  if (!installed) return;
  clearReconnect();
  reconnectAttempt = 0;
  installSubscription();
}

export function installTransferRuntime(): () => void {
  if (installed) return () => undefined;
  installed = true;
  installSubscription();
  return () => {
    installed = false;
    clearReconnect();
    subscription?.dispose();
    subscription = null;
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = new Map();
  };
}
