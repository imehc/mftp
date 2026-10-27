import type { MobileNavigationConfig } from "~/bindings";

/** 跨 StrictMode 重挂载串行化；清理动作不能晚于新实例的启用动作。 */
export function createNavigationSync(
  send: (input: MobileNavigationConfig) => Promise<void>,
) {
  let revision = 0;
  let queue = Promise.resolve();
  return (input: MobileNavigationConfig) => {
    const current = ++revision;
    const task = queue.then(() =>
      current === revision ? send(input) : undefined,
    );
    queue = task.catch(() => {});
    return task;
  };
}
