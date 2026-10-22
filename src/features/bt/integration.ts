import { router } from "~/router";

import { useBtTasksStore } from "./tasks-store";

export { installBtRuntime } from "./runtime/btRuntime";

/** 快照未就绪时返回 null，调用方显示占位符而不是「空闲」。 */
export function useBtRunningTaskCount(): number | null {
  return useBtTasksStore((state) =>
    state.loading
      ? null
      : state.tasks.filter(
          (task) => task.status === "Active" || task.status === "Packaging",
        ).length,
  );
}

/** 只登记重试意图，实际写操作由用户在 BT 页面再次确认。 */
export async function retryBtSource(magnet: string) {
  useBtTasksStore.getState().requestAddSource(magnet);
  await router.navigate({ to: "/tools/bt" });
}
