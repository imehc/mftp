import { describe, expect, it, vi } from "vitest";

import { awaitConversion } from "./await-conversion";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("转换取消与真实退出", () => {
  it("取消不会提前结束等待，任务退出后才返回取消", async () => {
    const work = deferred<number>();
    const controller = new AbortController();
    const cancel = vi.fn();
    let settled = false;
    const result = awaitConversion(
      work.promise,
      controller.signal,
      cancel,
    ).catch((error) => {
      settled = true;
      return error;
    });
    controller.abort();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    work.resolve(42);
    expect(await result).toMatchObject({ name: "AbortError" });
  });

  it("提前取消也等待已创建任务的拒绝，避免悬空任务", async () => {
    const work = deferred<number>();
    const controller = new AbortController();
    const cancel = vi.fn();
    controller.abort();
    const result = awaitConversion(
      work.promise,
      controller.signal,
      cancel,
    ).catch((error) => error);
    expect(cancel).toHaveBeenCalledTimes(1);
    work.reject(new Error("Input disposed"));
    expect(await result).toMatchObject({ name: "AbortError" });
  });

  it("正常完成解除取消监听，失败保留原始错误", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    expect(
      await awaitConversion(Promise.resolve(3), controller.signal, cancel),
    ).toBe(3);
    controller.abort();
    expect(cancel).not.toHaveBeenCalled();
    const failure = new Error("Encoder failed");
    await expect(
      awaitConversion(Promise.reject(failure), undefined, cancel),
    ).rejects.toBe(failure);
  });
});
