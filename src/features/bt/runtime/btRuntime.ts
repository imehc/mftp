import { listen } from "@tauri-apps/api/event";

import { toIpcError } from "~/lib/errors";
import {
  createSubscription,
  type Subscription,
} from "~/lib/event-subscription";
import { BT_TASK_EVENT } from "~/lib/events";
import { isIosPlatform } from "~/lib/platform";
import { createPoller, type Poller } from "~/lib/polling";
import { useTransfersStore } from "~/store/transfers";
import type { BtTaskEvent } from "~/types";

import { updatePeerWatch } from "../peer-watch";
import { applyBtTaskEvent } from "../task-events";
import { syncBtTasks } from "../task-sync";
import { refreshBtTasks, useBtTasksStore } from "../tasks-store";

const POLL_INTERVAL_MS = 2000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * BT 模块运行期：任务快照的读取、事件监听与向传输面板的投影都与页面无关，
 * 因此由应用运行期安装一次，页面只在需要时申请高频轮询。
 */

let installed = false;
let poller: Poller | null = null;
let subscription: Subscription | null = null;
let pageLeases = 0;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeTransfers: (() => void) | null = null;
let unsubscribeTasks: (() => void) | null = null;

/** BT 只在桌面端和 Android 提供本地引擎；iOS 不安装运行期。 */
export function isBtRuntimeAvailable(): boolean {
  return !isIosPlatform();
}

/**
 * 页面打开，或传输面板里仍有 BT 任务在跑时，才需要 2s 级轮询。
 *
 * 轮询会触发后端的引擎初始化，因此不能在应用启动时无条件开启；
 * BT 页挂载期间的 `acquireBtPage` 和已登记的 BT 传输是唯一的两个触发源。
 */
function shouldPoll(): boolean {
  if (pageLeases > 0) return true;
  return useTransfersStore
    .getState()
    .transfers.some(
      (item) => item.source === "bt" && item.status === "running",
    );
}

function reevaluatePolling(): void {
  const wanted = shouldPoll();
  if (wanted && !poller) {
    poller = createPoller(() => refreshBtTasks(), {
      intervalMs: POLL_INTERVAL_MS,
      pauseWhenHidden: true,
    });
  } else if (!wanted) {
    poller?.stop();
    poller = null;
  }
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
      listen<BtTaskEvent>(BT_TASK_EVENT, (event) => {
        applyBtTaskEvent(event.payload);
        void refreshBtTasks();
      }),
    {
      onError: (cause) => {
        failed = true;
        useBtTasksStore
          .getState()
          .setSubscriptionError(toIpcError(cause).payload);
        scheduleReconnect();
      },
    },
  );
  subscription = next;
  void next.ready.then(() => {
    // 注册成功才清错误并重置退避；被替换或被释放的旧订阅不再影响状态。
    if (subscription !== next || failed) return;
    reconnectAttempt = 0;
    if (useBtTasksStore.getState().subscriptionError) {
      useBtTasksStore.getState().setSubscriptionError(null);
    }
  });
}

/** 监听失败后由界面触发的立即重连。 */
export function retryBtSubscription(): void {
  if (!installed) return;
  clearReconnect();
  reconnectAttempt = 0;
  installSubscription();
  void refreshBtTasks();
}

/** BT 页挂载期间申请高频轮询；返回幂等的释放函数。 */
export function acquireBtPage(): () => void {
  pageLeases += 1;
  reevaluatePolling();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pageLeases = Math.max(0, pageLeases - 1);
    reevaluatePolling();
  };
}

export function installBtRuntime(): () => void {
  if (!isBtRuntimeAvailable() || installed) return () => undefined;
  installed = true;
  installSubscription();
  // 刻意不在启动时读取任务列表：后端的 `bt_list` 会顺带初始化 BT 引擎，
  // 而用户可能从不使用 BT。快照在页面打开或已有 BT 传输时按需校准。
  unsubscribeTransfers = useTransfersStore.subscribe(reevaluatePolling);
  // 快照变化驱动传输面板投影（注册、结账、打包进度）。
  unsubscribeTasks = useBtTasksStore.subscribe((state, previous) => {
    if (state.tasks === previous.tasks) return;
    syncBtTasks(state.tasks);
    updatePeerWatch(state.tasks);
    reevaluatePolling();
  });
  reevaluatePolling();
  return () => {
    installed = false;
    clearReconnect();
    subscription?.dispose();
    subscription = null;
    unsubscribeTransfers?.();
    unsubscribeTransfers = null;
    unsubscribeTasks?.();
    unsubscribeTasks = null;
    pageLeases = 0;
    poller?.stop();
    poller = null;
  };
}
