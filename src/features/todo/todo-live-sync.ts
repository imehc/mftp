import { listen } from "@tauri-apps/api/event";

import { createSubscription } from "~/lib/event-subscription";
import { TODO_CHANGED } from "~/lib/events";
import { isTauriRuntime } from "~/lib/files";
import { createPoller, type Poller } from "~/lib/polling";

import type { createTodoController } from "./todo-controller";

type Controller = Pick<
  ReturnType<typeof createTodoController>,
  "start" | "stop" | "externalChanged"
>;

export function startTodoLiveSync(controller: Controller) {
  let active = true;
  let fallback: Poller | null = null;
  void controller.start();
  if (!isTauriRuntime()) return () => controller.stop();

  const refresh = () => {
    if (active && !document.hidden) controller.externalChanged();
  };

  const subscription = createSubscription(
    () =>
      listen(TODO_CHANGED, () => {
        if (active) controller.externalChanged();
      }),
    {
      onError: () => {
        fallback = createPoller(async () => refresh(), {
          intervalMs: 5_000,
          pauseWhenHidden: true,
        });
      },
    },
  );
  // 注册为异步，先读后订阅的窗口内可能漏掉提交；就绪后补一次权威读取。
  void subscription.ready.then(refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);

  return () => {
    active = false;
    subscription.dispose();
    fallback?.stop();
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
    controller.stop();
  };
}
