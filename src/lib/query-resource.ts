import {
  type QueryClient,
  type QueryKey,
  QueryObserver,
} from "@tanstack/react-query";

import { ipcQuery, queryClient } from "./query-client";

/** 非 React 控制器的只读数据接口；数据唯一存放于 QueryCache。 */
export function createQueryResource<T>(
  key: QueryKey,
  read: () => Promise<T>,
  client: QueryClient = queryClient,
  onInvalidate?: () => void,
) {
  const options = ipcQuery(key, read);
  const listeners = new Set<() => void>();

  let disconnect = () => {};

  let started = false;
  const resource = {
    client,
    options,
    get: () => client.getQueryData<T>(key),
    cancel() {
      void client.cancelQueries({ queryKey: key, exact: true });
    },
    set(value: T) {
      // 权威写入覆盖快照前让旧读取失效；不声称取消了原生 worker。
      void client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData(key, value);
    },
    fetch(force = false): Promise<T> {
      started = true;
      return client.query({ ...options, ...(force ? { staleTime: 0 } : {}) });
    },
    clear() {
      started = false;
      client.removeQueries({ queryKey: key, exact: true });
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      if (listeners.size === 1) {
        // 每个资源只保留一个观察者维持缓存寿命；读取仍由控制器准入。
        const observed = { ...options, enabled: false };
        const observer = new QueryObserver(client, observed);
        const unobserve = observer.subscribe(() => {});
        const unsubscribe = client.getQueryCache().subscribe((event) => {
          if (event.query.queryHash !== observer.getCurrentQuery().queryHash)
            return;
          if (event.type === "added") observer.setOptions(observed);
          if (!["added", "removed", "updated"].includes(event.type)) return;
          listeners.forEach((listener) => listener());
          if (
            event.type === "updated" &&
            event.action.type === "invalidate" &&
            started
          ) {
            // 多个消费者只触发一次失效；未启动的 BT 等资源不能因此被初始化。
            if (onInvalidate) onInvalidate();
            else void resource.fetch(true).catch(() => {});
          }
        });
        disconnect = () => {
          unsubscribe();
          unobserve();
          observer.destroy();
        };
      }
      return () => {
        listeners.delete(notify);
        if (!listeners.size) disconnect();
      };
    },
  };
  return resource;
}

export type QueryResource<T> = ReturnType<typeof createQueryResource<T>>;
