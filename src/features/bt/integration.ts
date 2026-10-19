import { router } from "~/router";

import { useBtTasksStore } from "./tasks-store";

export { installBtRuntime } from "./runtime/btRuntime";

/** 只登记重试意图，实际写操作由用户在 BT 页面再次确认。 */
export async function retryBtSource(magnet: string) {
  useBtTasksStore.getState().requestAddSource(magnet);
  await router.navigate({ to: "/tools/bt" });
}
