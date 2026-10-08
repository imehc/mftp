import { describe, expect, it, vi } from "vitest";

import type { AiConfigurationView } from "~/bindings";

import { createAiConfigurationStore } from "./store";

function view(
  revision: number,
  activeProviderId: string | null = null,
): AiConfigurationView {
  return {
    revision,
    activeProviderId,
    streamingEnabled: true,
    providers: [],
    labelCandidates: [],
    modelCandidates: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const failure = {
  kind: "custom" as const,
  code: "ai:revision_conflict",
  message: "Configuration changed",
  args: {},
};

describe("AI 配置同步", () => {
  it("对并发元数据读取去重", async () => {
    const result = deferred<AiConfigurationView>();
    const read = vi.fn(() => result.promise);
    const store = createAiConfigurationStore(read);
    const first = store.getState().refresh();
    const second = store.getState().refresh();
    expect(first).toBe(second);
    result.resolve(view(1));
    await first;
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getState().loading).toBe(false);
  });

  it("不让延迟读取覆盖变更快照", async () => {
    const result = deferred<AiConfigurationView>();
    const store = createAiConfigurationStore(() => result.promise);
    const pending = store.getState().refresh();
    await store.getState().execute(async () => view(2, "B"));
    result.resolve(view(1, "A"));
    await pending;
    expect(store.getState().view?.activeProviderId).toBe("B");
    expect(store.getState().view?.revision).toBe(2);
  });

  it("拒绝同一时刻的重复提交且不保留输入", async () => {
    const result = deferred<AiConfigurationView>();
    const store = createAiConfigurationStore();
    const first = store.getState().execute(() => result.promise);
    const duplicate = vi.fn(async () => view(3));
    expect(await store.getState().execute(duplicate)).toBe(false);
    expect(duplicate).not.toHaveBeenCalled();
    result.resolve(view(2));
    expect(await first).toBe(true);
    expect(store.getState().busy).toBe(false);
  });

  it("刷新冲突但绝不重放写入或认证", async () => {
    const store = createAiConfigurationStore(async () => view(8));
    const mutation = vi.fn(async () => {
      throw failure;
    });
    expect(await store.getState().execute(mutation)).toBe(false);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(store.getState().view?.revision).toBe(8);
    expect(store.getState().error).toEqual(failure);
  });

  it("读取出错时保留现有数据，不显示空配置", async () => {
    const store = createAiConfigurationStore(async () => {
      throw failure;
    });
    await store.getState().execute(async () => view(4, "A"));
    expect(await store.getState().refresh()).toBe(false);
    expect(store.getState().view?.activeProviderId).toBe("A");
    expect(store.getState().error).toEqual(failure);
  });

  it("重新加载部分删除结果，同时保留原始错误", async () => {
    const store = createAiConfigurationStore(async () => view(6));
    await store.getState().execute(async () => view(5, "A"));
    const cleanup = {
      ...failure,
      kind: "external" as const,
      code: "credential:store",
    };
    await store.getState().execute(async () => {
      throw cleanup;
    });
    expect(store.getState().view?.activeProviderId).toBeNull();
    expect(store.getState().error).toEqual(cleanup);
  });

  it("使用后端响应原子替换地址和两个选择", async () => {
    const store = createAiConfigurationStore();
    const a = {
      id: "A",
      name: "A",
      baseUrl: "https://a.invalid",
      requiresAddressRepair: false,
      revision: 1,
      currentKeyId: "a-key",
      currentModelId: "a-model",
      keys: [],
      models: [],
    };
    const b = {
      ...a,
      id: "B",
      currentKeyId: "b-key",
      currentModelId: "b-model",
    };
    for (const [revision, active] of [
      [1, "A"],
      [2, "B"],
      [3, "A"],
    ] as const) {
      await store.getState().execute(async () => ({
        ...view(revision, active),
        providers: [a, b],
      }));
      const selected = store
        .getState()
        .view!.providers.find((p) => p.id === active)!;
      expect([selected.currentKeyId, selected.currentModelId]).toEqual(
        active === "A" ? ["a-key", "a-model"] : ["b-key", "b-model"],
      );
    }
  });
});
