import { listen } from "@tauri-apps/api/event";

import type { AppError, DiagnosticSnapshot } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  createSubscription,
  type Subscription,
} from "~/lib/event-subscription";
import { ACTIVITY_PANEL } from "~/lib/events";
import { diagnosticsSnapshot } from "~/lib/ipc";

/** 事件丢失时的兜底间隔；正常情况下面板由后端推送驱动。 */
export const FALLBACK_POLL_MS = 5000;

interface Port {
  snapshot: (after: number) => Promise<DiagnosticSnapshot>;
  subscribe: (onChange: () => void) => Subscription;
}

const defaultPort: Port = {
  snapshot: diagnosticsSnapshot,
  subscribe: (onChange) =>
    createSubscription(() => listen(ACTIVITY_PANEL, onChange)),
};

/**
 * 读取应用级活动面板。记录由后端持有，这里只按游标重读快照，
 * 永不重放业务命令，也不取消正在运行的操作。
 *
 * 更新由后端事件驱动，游标仍是权威信号：事件只是「有新版本」的提示，
 * 合并高频推送且允许丢失，丢失只影响延迟，不会漏记录。
 */
export function openExecutionLogSession(
  onSnapshot: (snapshot: DiagnosticSnapshot) => void,
  onError: (error: AppError | null) => void,
  port: Port = defaultPort,
) {
  let closed = false;
  let cursor = 0;
  let reading = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function read() {
    if (closed) return;
    // 一次只允许一个在途读取；期间的推送合并成一次补读。
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      const snapshot = await port.snapshot(cursor);
      if (closed) return;
      cursor = snapshot.cursor;
      onSnapshot(snapshot);
      onError(null);
    } catch (cause) {
      if (!closed) onError(toIpcError(cause).payload);
    } finally {
      reading = false;
      if (pending && !closed) {
        pending = false;
        void read();
      }
    }
  }

  function scheduleFallback() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void read();
      scheduleFallback();
    }, FALLBACK_POLL_MS);
  }

  const subscription = port.subscribe(() => void read());
  void read();
  scheduleFallback();

  return {
    refresh: () => void read(),
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      subscription.dispose();
    },
  };
}
