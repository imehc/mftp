import type { Query, QueryClient, QueryFilters } from "@tanstack/react-query";

const pending = new WeakMap<Query, { again: boolean; task: Promise<void> }>();

/** 等待现有查询再补读并合并事件；显式取消只放弃结果，不代表原生 worker 退出。 */
export function refreshQueries(client: QueryClient, filters: QueryFilters) {
  const cache = client.getQueryCache();
  return Promise.all(
    cache.findAll(filters).map((query) => {
      const existing = pending.get(query);
      if (existing) {
        existing.again = true;
        return existing.task;
      }
      const state = { again: true, task: Promise.resolve() };
      state.task = (async () => {
        await query.promise?.catch(() => undefined);
        while (state.again && cache.get(query.queryHash) === query) {
          state.again = false;
          await client.invalidateQueries(
            { queryKey: query.queryKey, exact: true },
            { cancelRefetch: false },
          );
          // 非 React 控制器使用禁用的观察者，失效后由自身准入触发读取。
          await query.promise?.catch(() => undefined);
        }
      })().finally(() => pending.delete(query));
      pending.set(query, state);
      return state.task;
    }),
  );
}
