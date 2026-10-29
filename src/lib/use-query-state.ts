import { useSyncExternalStore } from "react";

import type { QueryResource } from "./query-resource";

/** 受控运行期的 React 投影；查询结果只在 QueryCache 保存，动作仍由调用方准入。 */
export function useQueryState<T>(resource: QueryResource<T>, fallback: T) {
  const data = useSyncExternalStore(resource.subscribe, resource.get);

  const set = (update: T | ((current: T) => T)) => {
    resource.set(
      typeof update === "function"
        ? (update as (current: T) => T)(resource.get() ?? fallback)
        : update,
    );
  };

  return [data ?? fallback, set] as const;
}
