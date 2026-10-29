import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient, ipcQuery } from "./query-client";
import { createQueryResource } from "./query-resource";
import { createQueryStore } from "./query-store";

const clients: ReturnType<typeof createAppQueryClient>[] = [];

function client() {
  const value = createAppQueryClient();
  clients.push(value);
  return value;
}

afterEach(() => {
  clients.splice(0).forEach((value) => value.clear());
  onlineManager.setOnline(true);
});

describe("原生查询的数据归属与生命周期", () => {
  it("离线仍读取本机数据，同一查询复用在途请求", async () => {
    onlineManager.setOnline(false);
    const read = vi.fn(async () => [1]);
    const resource = createQueryResource(["test"], read, client());
    const [first, second] = await Promise.all([
      resource.fetch(),
      resource.fetch(),
    ]);
    expect(first).toEqual([1]);
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("读取失败保留结构化错误且不自动重试", async () => {
    const error = {
      kind: "custom",
      code: "poetry:not_found",
      message: "Not found",
      args: {},
    };
    const read = vi.fn(async () => {
      throw error;
    });
    await expect(
      client().query(ipcQuery(["test"], read)),
    ).rejects.toMatchObject({ payload: error });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("控制器查询字段直接投影缓存，UI 状态独立保存", async () => {
    const cache = client();
    const resource = createQueryResource(["test"], async () => [1], cache);
    const store = createQueryStore<{
      items: number[];
      open: boolean;
      append(): void;
    }>(
      (set, get) => ({
        items: [],
        open: false,
        append: () => set({ items: [...get().items, 3] }),
      }),
      { items: resource },
    );
    await resource.fetch();
    expect(store.getState().items).toEqual([1]);
    cache.setQueryData(["test"], [2]);
    store.getState().append();
    expect(cache.getQueryData(["test"])).toEqual([2, 3]);
    store.setState({ open: true });
    cache.removeQueries({ queryKey: ["test"] });
    expect(store.getState()).toMatchObject({ items: [], open: true });
  });

  it("清空查询后迟到的读取不能恢复旧数据", async () => {
    let resolve!: (value: number[]) => void;
    const cache = client();
    const resource = createQueryResource(
      ["test"],
      () =>
        new Promise<number[]>((done) => {
          resolve = done;
        }),
      cache,
    );
    const reading = resource.fetch().catch(() => undefined);
    cache.clear();
    resolve([1]);
    await reading;
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  });

  it("权威写入快照不会被更早的读取覆盖", async () => {
    let resolve!: (value: number[]) => void;
    const resource = createQueryResource(
      ["test"],
      () =>
        new Promise<number[]>((done) => {
          resolve = done;
        }),
      client(),
    );
    const reading = resource.fetch().catch(() => undefined);
    resource.set([2]);
    resolve([1]);
    await reading;
    expect(resource.get()).toEqual([2]);
  });
});

it("未启动的受控资源不因失效而执行读取，清理后仍能观察新缓存", async () => {
  const cache = client();
  const read = vi.fn(async () => [1]);
  const resource = createQueryResource(["lazy"], read, cache);
  const changed = vi.fn();
  const stop = resource.subscribe(changed);
  await cache.invalidateQueries({ queryKey: ["lazy"] });
  expect(read).not.toHaveBeenCalled();
  await resource.fetch();
  cache.removeQueries({ queryKey: ["lazy"] });
  await resource.fetch();
  cache.setQueryData(["lazy"], [2]);
  expect(resource.get()).toEqual([2]);
  expect(changed).toHaveBeenCalled();
  stop();
});

it("控制器失效回调负责写锁准入，失效本身不绕开它读取", async () => {
  const cache = client();
  const read = vi.fn(async () => [1]);
  const changed = vi.fn();
  const resource = createQueryResource(["controlled"], read, cache, changed);
  const stop = resource.subscribe(() => {});
  await resource.fetch();
  await cache.invalidateQueries({ queryKey: ["controlled"] });
  expect(changed).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  stop();
});
