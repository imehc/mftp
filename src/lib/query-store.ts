import {
  type StateCreator,
  type StoreApi,
  type UseBoundStore,
  useStore,
} from "zustand";
import { createStore } from "zustand/vanilla";

import type { QueryResource } from "./query-resource";

type Fields<T> = Partial<{ [K in keyof T]: QueryResource<T[K]> }>;

/** 保留控制器状态 API，但查询字段只从 QueryCache 投影，写回也只更新该缓存。 */
export function createQueryStore<T extends object>(
  initialize: StateCreator<T>,
  fields: Fields<T>,
): UseBoundStore<StoreApi<T>> {
  const keys = Object.keys(fields) as (keyof T)[];
  let snapshot: T;
  let depth = 0;
  const listeners = new Set<(state: T, previous: T) => void>();
  let subscriptions: (() => void)[] = [];
  const holder: { current?: StoreApi<T> } = {};
  const local = createStore<T>((set, get, storeApi) =>
    initialize(
      ((...args: Parameters<StoreApi<T>["setState"]>) =>
        holder.current
          ? holder.current.setState(...args)
          : set(...args)) as StoreApi<T>["setState"],
      () => (holder.current ? holder.current.getState() : get()),
      storeApi,
    ),
  );
  const initial = local.getInitialState();

  // 初始值仅作无数据时的回退，不保存后续查询响应。
  const project = () => {
    const value = { ...local.getState() };
    for (const key of keys) {
      const data = fields[key]!.get();
      value[key] = data === undefined ? initial[key] : data;
    }
    return value;
  };

  snapshot = project();

  function publish() {
    if (depth) return;
    const next = project();
    if (
      Object.keys(next).every((key) =>
        Object.is(next[key as keyof T], snapshot[key as keyof T]),
      )
    )
      return;
    const previous = snapshot;
    snapshot = next;
    listeners.forEach((listener) => listener(next, previous));
  }

  const api: StoreApi<T> = {
    getState() {
      publish();
      return snapshot;
    },
    getInitialState: () => initial,
    setState: ((
      update: T | Partial<T> | ((state: T) => T | Partial<T>),
      replace?: boolean,
    ) => {
      const value =
        typeof update === "function" ? update(api.getState()) : update;
      depth++;
      try {
        const patch = { ...value };
        for (const key of keys) {
          if (Object.hasOwn(patch, key)) {
            fields[key]!.set(patch[key] as T[typeof key]);
            delete patch[key];
          }
        }
        local.setState(patch, replace as false);
      } finally {
        depth--;
      }
      publish();
    }) as StoreApi<T>["setState"],
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1)
        subscriptions = keys.map((key) => fields[key]!.subscribe(publish));
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          subscriptions.forEach((stop) => stop());
          subscriptions = [];
        }
      };
    },
  };
  holder.current = api;

  function useBound(): T;
  function useBound<U>(selector: (state: T) => U): U;
  function useBound(selector?: (state: T) => unknown) {
    return useStore(api, selector ?? ((state: T) => state));
  }

  return Object.assign(useBound, api);
}
