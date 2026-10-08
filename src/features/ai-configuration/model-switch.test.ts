import { describe, expect, it, vi } from "vitest";
import type { AiConfigurationView, AiProviderView } from "~/bindings";
import { createAiConfigurationStore } from "./store";

function snapshot(): AiConfigurationView {
  const provider = (id: string): AiProviderView => ({
    id,
    name: id,
    baseUrl: `https://${id}.example.invalid/v1`,
    revision: 1,
    requiresAddressRepair: false,
    currentKeyId: `${id}-key`,
    currentModelId: `${id}-one`,
    keys: [{ id: `${id}-key`, label: "test", state: "savedUnverified" }],
    models: ["one", "two"].map((model) => ({
      id: `${id}-${model}`,
      modelId: model,
      displayName: null,
    })),
  });
  return {
    revision: 1,
    activeProviderId: "a",
    streamingEnabled: true,
    providers: [provider("a"), provider("b")],
    labelCandidates: [],
    modelCandidates: [],
  };
}
const input = {
  expectedRevision: 1,
  expectedActiveProviderId: "a",
  modelId: "a-two",
};

describe("全局 AI 模型选择", () => {
  it("使用一次后端快照切换当前地址模型且不改变其键", async () => {
    const view = snapshot();
    const next = snapshot();
    next.revision = 2;
    next.providers[0].currentModelId = "a-two";
    const write = vi.fn(async () => next);
    const store = createAiConfigurationStore(async () => view, write);
    await store.getState().refresh();
    expect(await store.getState().switchModel(input)).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(input);
    expect(store.getState().view).toEqual(next);
    expect(store.getState().view?.providers[0].currentKeyId).toBe("a-key");
  });
  it("地址切换后拒绝其他地址、外部模型、过期版本和回调", async () => {
    const write = vi.fn(async () => snapshot());
    const store = createAiConfigurationStore(async () => snapshot(), write);
    await store.getState().refresh();
    expect(
      await store.getState().switchModel({
        ...input,
        expectedActiveProviderId: "b",
        modelId: "b-two",
      }),
    ).toBe(false);
    expect(
      await store.getState().switchModel({ ...input, modelId: "b-two" }),
    ).toBe(false);
    expect(
      await store.getState().switchModel({ ...input, expectedRevision: 0 }),
    ).toBe(false);
    const next = snapshot();
    next.activeProviderId = "b";
    store.setState({ view: next });
    expect(await store.getState().switchModel(input)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it("阻止加载中、忙碌和损坏的地址且不重写所选模型", async () => {
    const write = vi.fn(async () => snapshot());
    const store = createAiConfigurationStore(async () => snapshot(), write);
    await store.getState().refresh();
    expect(
      await store.getState().switchModel({ ...input, modelId: "a-one" }),
    ).toBe(true);
    store.setState({ loading: true });
    expect(await store.getState().switchModel(input)).toBe(false);
    store.setState({ loading: false, busy: true });
    expect(await store.getState().switchModel(input)).toBe(false);
    const view = snapshot();
    view.providers[0].requiresAddressRepair = true;
    store.setState({ busy: false, view });
    expect(await store.getState().switchModel(input)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it("版本冲突后刷新但不重放选择操作", async () => {
    const next = snapshot();
    next.revision = 2;
    next.activeProviderId = "b";
    const error = {
      kind: "custom" as const,
      code: "ai:revision_conflict",
      message: "Changed",
      args: {},
    };
    const read = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(next);
    const write = vi.fn().mockRejectedValue(error);
    const store = createAiConfigurationStore(read, write);
    await store.getState().refresh();
    expect(await store.getState().switchModel(input)).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.getState().view).toEqual(next);
    expect(store.getState().error).toEqual(error);
  });
});
