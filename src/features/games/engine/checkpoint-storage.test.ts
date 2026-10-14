import { afterEach, expect, it, vi } from "vitest";

import { checkpointStorage, clearGameCheckpoints } from "./checkpoint-storage";

const tick = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

function databaseFixture() {
  const values = new Map<string, unknown>();
  const operations: { commit(): void; abort(): void }[] = [];
  const close = vi.fn();
  const transaction = vi.fn(
    (_table: string, _mode: string, _options: unknown) => {
      const current: {
        oncomplete?: () => void;
        onabort?: () => void;
        error?: Error;
      } = {};
      const request = { result: undefined as unknown };

      let operation = () => {};

      const table = {
        get: (key: string) => {
          operation = () => {
            request.result = values.get(key);
          };
          return request;
        },
        put: (value: unknown, key: string) => {
          operation = () => {
            values.set(key, structuredClone(value));
          };
          return request;
        },
        delete: (key: string) => {
          operation = () => {
            values.delete(key);
          };
          return request;
        },
        clear: () => {
          operation = () => values.clear();
          return request;
        },
      };
      operations.push({
        commit: () => {
          operation();
          current.oncomplete?.();
        },
        abort: () => {
          current.error = new Error("isolated transaction failure");
          current.onabort?.();
        },
      });
      return {
        objectStore: () => table,
        set oncomplete(callback: () => void) {
          current.oncomplete = callback;
        },
        set onabort(callback: () => void) {
          current.onabort = callback;
        },
        get error() {
          return current.error;
        },
      };
    },
  );
  const database = { transaction, close };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: { result: typeof database; onsuccess?: () => void } = {
        result: database,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return { values, operations, close, transaction };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("只在事务提交后报告成功，保存与删除严格按顺序执行", async () => {
  const database = databaseFixture();
  const saved = vi.fn();
  const write = checkpointStorage.write("game", { state: 1 }).then(saved);
  const remove = checkpointStorage.remove("game");
  await tick();
  expect(database.operations).toHaveLength(1);
  expect(saved).not.toHaveBeenCalled();
  database.operations[0].commit();
  await write;
  await tick();
  expect(saved).toHaveBeenCalledOnce();
  expect(database.operations).toHaveLength(2);
  expect(database.values.get("game")).toEqual({ state: 1 });
  database.operations[1].commit();
  await remove;
  expect(database.values.has("game")).toBe(false);
  expect(database.transaction).toHaveBeenCalledWith("sessions", "readwrite", {
    durability: "strict",
  });
  expect(database.close).toHaveBeenCalledTimes(2);
});

it("失败保留旧值且不堵住后续读取和清理", async () => {
  const database = databaseFixture();
  database.values.set("game", { state: "previous" });
  const write = checkpointStorage.write("game", { state: "new" });
  const failed = expect(write).rejects.toThrow("isolated transaction failure");
  await tick();
  database.operations[0].abort();
  await failed;
  const read = checkpointStorage.read("game");
  await tick();
  database.operations[1].commit();
  expect(await read).toEqual({ state: "previous" });
  const clear = clearGameCheckpoints();
  await tick();
  database.operations[2].commit();
  await clear;
  expect(database.values.size).toBe(0);
});
