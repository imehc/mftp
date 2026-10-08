import { create } from "zustand";

import { toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { AppError, BtTaskInfo } from "~/types";

/**
 * BT 任务快照的全局投影。读取与监听由模块运行期（`runtime/btRuntime`）
 * 驱动，不由某个页面驱动；页面只消费快照并触发按需刷新。
 */
interface BtTasksState {
  tasks: BtTaskInfo[];
  /** 最近一次列表读取失败；保留上一份快照，不把失败显示成空列表。 */
  error: AppError | null;
  /** 任务事件监听安装失败；与读取失败分开表达。 */
  subscriptionError: AppError | null;
  loading: boolean;
  /** 长时间没有对等节点的任务；由快照派生，页面只读。 */
  noPeers: Set<string>;
  /** 其他页面发起的「打开添加对话框」意图，由 BT 页消费一次。 */
  pendingAddSource: string | null;
  setTasks: (tasks: BtTaskInfo[]) => void;
  setError: (error: AppError | null) => void;
  setSubscriptionError: (error: AppError | null) => void;
  setLoading: (loading: boolean) => void;
  setNoPeers: (noPeers: Set<string>) => void;
  requestAddSource: (source: string) => void;
  consumeAddSource: () => void;
}

export const useBtTasksStore = create<BtTasksState>((set) => ({
  tasks: [],
  error: null,
  subscriptionError: null,
  loading: true,
  noPeers: new Set(),
  pendingAddSource: null,
  setTasks: (tasks) => set({ tasks }),
  setError: (error) => set({ error }),
  setSubscriptionError: (subscriptionError) => set({ subscriptionError }),
  setLoading: (loading) => set({ loading }),
  setNoPeers: (noPeers) => set({ noPeers }),
  requestAddSource: (pendingAddSource) => set({ pendingAddSource }),
  consumeAddSource: () => set({ pendingAddSource: null }),
}));

/**
 * 串行读取任务列表：同一时刻只有一次在途请求，在途期间的触发合并为
 * 一次补跑。结果总是写入同一个全局快照，因此不存在旧请求覆盖新页面的问题。
 */
let inFlight: { again: boolean; promise: Promise<void> } | null = null;

export function refreshBtTasks(): Promise<void> {
  const previous = inFlight;
  if (previous) {
    previous.again = true;
    return previous.promise;
  }
  const request = { again: false, promise: Promise.resolve() };
  inFlight = request;
  request.promise = (async () => {
    do {
      request.again = false;
      try {
        const list = await ipc.btList();
        if (request.again) continue;
        useBtTasksStore.getState().setTasks(list);
        useBtTasksStore.getState().setError(null);
      } catch (cause) {
        // 读取失败保留最后一次任务快照，不能把失败伪装成空列表。
        if (request.again) continue;
        useBtTasksStore.getState().setError(toIpcError(cause).payload);
      }
    } while (request.again);
    useBtTasksStore.getState().setLoading(false);
    if (inFlight === request) inFlight = null;
  })();
  return request.promise;
}
