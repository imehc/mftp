import type { ModelOpenRequest, ModelThermalState } from "~/bindings";
import { type IpcError, toIpcError } from "~/lib/errors";
import { isTauriRuntime } from "~/lib/files";
import { modelSystemPoll } from "~/lib/ipc";

import { modelError } from "../domain/errors";
import type { ViewerSession } from "../runtime/session";
import { nativeSource } from "../sources/native";

type State = { thermal: ModelThermalState; error: IpcError | null };

let state: State = { thermal: "unknown", error: null };
const listeners = new Set<() => void>();
const pending: ModelOpenRequest[] = [];
let consumer: ViewerSession | null = null;
let running = false;
let refs = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let navigate: (() => Promise<unknown>) | null = null;

function publish(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const systemSnapshot = () => state;

export const subscribeSystem = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const clearSystemError = () => publish({ error: null });

function deliver() {
  if (!consumer || !pending.length) return;
  const files = pending.splice(0);
  void consumer.enqueue(
    files.map((file) => ({
      name: file.name,
      open: async () => ({
        ...(await nativeSource(file.path)),
        name: file.name,
      }),
    })),
  );
}

export function attachSystemInbox(session: ViewerSession) {
  consumer = session;
  deliver();
  return () => {
    if (consumer === session) consumer = null;
  };
}

async function poll() {
  if (running || !refs || document.hidden) return;
  running = true;
  try {
    const snapshot = await modelSystemPoll();
    // 接收结果保存在跨页内存中；StrictMode 卸载不会丢失已取出的系统请求。
    const paths = new Set(pending.map((file) => file.path));
    for (const file of snapshot.files) {
      if (!paths.has(file.path) && pending.length < 8) {
        pending.push(file);
        paths.add(file.path);
      }
    }
    publish({
      thermal: snapshot.thermal,
      ...(snapshot.failed ? { error: modelError("system_open") } : {}),
    });
    if (refs && (pending.length || snapshot.failed)) {
      if (!consumer) await navigate?.();
      deliver();
    }
  } catch (error) {
    publish({ error: toIpcError(error) });
  } finally {
    running = false;
  }
}

export function installModelSystemRuntime(go: () => Promise<unknown>) {
  if (!isTauriRuntime()) return () => {};
  navigate = go;
  refs++;
  if (refs === 1) {
    timer = setInterval(() => void poll(), 2000);
    document.addEventListener("visibilitychange", poll);
    void poll();
  }
  return () => {
    refs--;
    if (!refs) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    }
  };
}
