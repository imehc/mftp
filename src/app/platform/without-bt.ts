import { router } from "~/router";

/** iOS 产物不装配 BT 运行时。 */
export function installBtRuntime() {
  return () => {};
}

/** 旧状态中的重试意图只能返回可用入口，不能执行不可用命令。 */
export async function retryBtSource(_magnet: string) {
  await router.navigate({ to: "/" });
}

/** 平台没有下载引擎，跨页面状态位恒不可用。 */
export function useBtRunningTaskCount(): number | null {
  return null;
}
