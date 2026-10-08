import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FBX_PARSE_TIMEOUT } from "./fbx-policy";
import { parseFbxTask } from "./fbx-task";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}

beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("预先取消时不创建后台解析任务", () => {
  const abort = new AbortController();
  abort.abort();
  expect(() => parseFbxTask(new ArrayBuffer(8), abort.signal)).toThrow();
  expect(TestWorker.instances).toHaveLength(0);
});

it("取消先终止实际 Worker，随后忽略晚到的完成消息", async () => {
  const abort = new AbortController();
  const task = parseFbxTask(new ArrayBuffer(8), abort.signal);
  const worker = TestWorker.instances[0],
    late = worker.onmessage!;
  const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  expect(worker.terminate).toHaveBeenCalledOnce();
  late({ data: { result: {} } });
  await assertion;
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("解析超时和 Worker 崩溃均终止任务，并保留明确错误类别", async () => {
  vi.useFakeTimers();
  const task = parseFbxTask(new ArrayBuffer(8), new AbortController().signal);
  const assertion = expect(task).rejects.toMatchObject({
    payload: { code: "model:fbx_limit" },
  });
  await vi.advanceTimersByTimeAsync(FBX_PARSE_TIMEOUT);
  await assertion;
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  const second = parseFbxTask(new ArrayBuffer(8), new AbortController().signal);
  TestWorker.instances[1].onerror!({ preventDefault: vi.fn() });
  await expect(second).rejects.toMatchObject({
    payload: { code: "model:decode" },
  });
});

it("成功移交和结构化失败均销毁 Worker 与监听器", async () => {
  const bytes = new ArrayBuffer(8);
  const task = parseFbxTask(bytes, new AbortController().signal);
  const worker = TestWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledWith(bytes, [bytes]);
  worker.onmessage!({
    data: {
      error: {
        kind: "external",
        code: "model:unsafe",
        message: "Unsafe FBX resource",
        args: {},
      },
    },
  });
  await expect(task).rejects.toMatchObject({
    payload: { code: "model:unsafe" },
  });
  expect(worker.onmessage).toBeNull();
  expect(worker.terminate).toHaveBeenCalledOnce();
  const success = parseFbxTask(
    new ArrayBuffer(8),
    new AbortController().signal,
  );
  const result = { images: [] };
  TestWorker.instances[1].onmessage!({ data: { result } });
  await expect(success).resolves.toBe(result);
  expect(TestWorker.instances[1].terminate).toHaveBeenCalledOnce();
});
