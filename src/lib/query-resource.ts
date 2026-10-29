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
  let listeners = 0;
  let started = false;
  return {
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
      listeners++;
      // 观察者只维持缓存寿命；首次读取仍由控制器的运行期准入。
      const observer = new QueryObserver(client, {
        ...options,
        enabled: false,
      });
      const unobserve = observer.subscribe(() => notify());
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash !== observer.getCurrentQuery().queryHash)
          return;
        if (event.type === "added")
          observer.setOptions({ ...options, enabled: false });
        notify();
        if (
          event.type === "updated" &&
          event.action.type === "invalidate" &&
          listeners > 0 &&
          started
        ) {
          // 已启动的控制器响应外部失效；尚未读取的 BT 等资源不能因此被初始化。
          if (onInvalidate) onInvalidate();
          else void this.fetch(true).catch(() => {});
        }
      });
      return () => {
        listeners--;
        unsubscribe();
        unobserve();
        observer.destroy();
      };
    },
  };
}

export type QueryResource<T> = ReturnType<typeof createQueryResource<T>>;
