// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { TranslationRequest, TranslationSnapshot } from "~/bindings";
import * as ipc from "~/lib/ipc";
import { createAppQueryClient } from "~/lib/query-client";

import { useTranslation } from "./use-translation";

vi.mock("~/lib/ipc", () => ({
  translationSnapshot: vi.fn(),
  translationRun: vi.fn(),
  translationCancel: vi.fn(),
  translationSelect: vi.fn(),
  translationDownload: vi.fn(),
  translationRemove: vi.fn(),
}));

const snapshot: TranslationSnapshot = {
  models: [],
  selectedId: "model-a",
  task: null,
};
const request: Omit<TranslationRequest, "requestId"> = {
  modelId: "model-a",
  text: "hello",
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
};
const client = createAppQueryClient();
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useTranslation>;

function Probe() {
  const value = useTranslation();
  useEffect(() => {
    controller = value;
  });
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(ipc.translationSnapshot).mockResolvedValue(snapshot);
  vi.mocked(ipc.translationCancel).mockResolvedValue();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryProvider client={client}>
        <Probe />
      </QueryProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("离线翻译任务生命周期", () => {
  it("忽略旧任务和重复序号，完成响应补齐流式尾部", async () => {
    const pending = deferred<string>();
    vi.mocked(ipc.translationRun).mockReturnValue(pending.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = controller.run(request);
    });
    const [input, emit] = vi.mocked(ipc.translationRun).mock.calls[0];
    await act(async () => {
      emit({ requestId: "old", sequence: 1, text: "错误" });
      emit({ requestId: input.requestId, sequence: 1, text: "中" });
      emit({ requestId: input.requestId, sequence: 1, text: "重复" });
      emit({ requestId: input.requestId, sequence: 2, text: "文" });
    });
    expect(controller.output).toBe("中文");
    await act(async () => {
      pending.resolve("完整译文");
      await done;
    });
    await act(async () =>
      emit({ requestId: input.requestId, sequence: 3, text: "迟到" }),
    );
    expect(controller.output).toBe("完整译文");
    expect(controller.busy).toBe(false);
    expect(controller.resultKey).toBe(JSON.stringify(request));
  });

  it("清空输入会丢弃进行中的翻译且不标记为已停止", async () => {
    const pending = deferred<string>();
    vi.mocked(ipc.translationRun).mockReturnValue(pending.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = controller.run(request);
    });
    const id = vi.mocked(ipc.translationRun).mock.calls[0][0].requestId;
    const [, emit] = vi.mocked(ipc.translationRun).mock.calls[0];
    await act(async () => {
      emit({ requestId: id, sequence: 1, text: "中" });
    });
    expect(controller.output).toBe("中");
    await act(async () => controller.clear());
    expect(controller.output).toBe("");
    expect(controller.resultKey).toBe("");
    expect(ipc.translationCancel).toHaveBeenCalledWith(id);
    await act(async () => {
      emit({ requestId: id, sequence: 2, text: "文" });
    });
    expect(controller.output).toBe("");
    await act(async () => {
      pending.reject({
        kind: "custom",
        code: "translation:cancelled",
        message: "Cancelled",
        args: {},
      });
      await done;
    });
    expect(controller.output).toBe("");
    expect(controller.cancelled).toBe(false);
  });

  it("请求取消后仍保持忙碌，直到真实任务返回", async () => {
    const pending = deferred<string>();
    vi.mocked(ipc.translationRun).mockReturnValue(pending.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = controller.run(request);
    });
    await act(async () => controller.stop());
    expect(controller.busy).toBe(true);
    expect(controller.stopping).toBe(true);
    await act(async () => {
      pending.reject({
        kind: "custom",
        code: "translation:cancelled",
        message: "Cancelled",
        args: {},
      });
      await done;
    });
    expect(controller.busy).toBe(false);
    expect(controller.cancelled).toBe(true);
    expect(controller.error).toBeNull();
  });

  it("重复启动只提交一次，离开页面取消所属翻译", async () => {
    const pending = deferred<string>();
    vi.mocked(ipc.translationRun).mockReturnValue(pending.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = controller.run(request);
      void controller.run(request);
    });
    expect(ipc.translationRun).toHaveBeenCalledTimes(1);
    const id = vi.mocked(ipc.translationRun).mock.calls[0][0].requestId;
    await act(async () => root.unmount());
    expect(ipc.translationCancel).toHaveBeenCalledWith(id);
    await act(async () => {
      pending.resolve("迟到译文");
      await done;
    });
  });
});
