import { QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient, ipcQuery } from "./query-client";
import { refreshQueries } from "./query-invalidation";

const client = createAppQueryClient();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => client.clear());

describe("查询事件补读", () => {
  it("读取期间的重复事件合并为完成后的一次补读", async () => {
    const first = deferred<number>();
    const read = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(2);
    const observer = new QueryObserver(client, ipcQuery(["test"], read));
    const stop = observer.subscribe(() => {});
    const refresh = refreshQueries(client, { queryKey: ["test"] });
    const duplicate = refreshQueries(client, { queryKey: ["test"] });
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve(1);
    await Promise.all([refresh, duplicate]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["test"])).toBe(2);
    stop();
  });

  it("补读期间的新事件会再读一次，后台失败保留已有数据", async () => {
    client.setQueryData(["test"], 0);
    const second = deferred<number>();
    const read = vi.fn().mockReturnValueOnce(second.promise).mockRejectedValue({
      kind: "custom",
      code: "test:failure",
      message: "Failure",
      args: {},
    });
    const observer = new QueryObserver(client, ipcQuery(["test"], read));
    const stop = observer.subscribe(() => {});
    const refresh = refreshQueries(client, { queryKey: ["test"] });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const again = refreshQueries(client, { queryKey: ["test"] });
    second.resolve(1);
    await Promise.all([refresh, again]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["test"])).toBe(1);
    expect(client.getQueryState(["test"])?.error).toMatchObject({
      payload: { code: "test:failure" },
    });
    stop();
  });

  it("清理后不补读或重建旧查询", async () => {
    const first = deferred<number>();
    const read = vi.fn(() => first.promise);
    const observer = new QueryObserver(client, ipcQuery(["test"], read));
    const stop = observer.subscribe(() => {});
    const refresh = refreshQueries(client, { queryKey: ["test"] });
    client.clear();
    first.resolve(1);
    await refresh;
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    stop();
  });
});
