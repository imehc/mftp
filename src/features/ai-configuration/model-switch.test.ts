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

describe("global AI model selection", () => {
  it("switches the current address model using one backend snapshot without changing its key", async () => {
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
  it("rejects other addresses, foreign models, stale versions and callbacks after an address switch", async () => {
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
  it("blocks loading, busy and damaged addresses and does not rewrite the selected model", async () => {
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
  it("refreshes after a version conflict without replaying the selection", async () => {
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
