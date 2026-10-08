import { describe, expect, it } from "vitest";
import type { AiConfigurationView, AiProviderView } from "~/bindings";
import { findExistingItem } from "./find-existing-item";

function provider(id: string): AiProviderView {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example.invalid/v1`,
    requiresAddressRepair: false,
    revision: 1,
    currentKeyId: `${id}-key`,
    currentModelId: `${id}-model`,
    keys: [{ id: `${id}-key`, label: "个人", state: "savedUnverified" }],
    models: [{ id: `${id}-model`, modelId: "model-A", displayName: null }],
  };
}
function fixture() {
  const a = provider("a"),
    b = provider("b");
  const view: AiConfigurationView = {
    revision: 1,
    activeProviderId: "b",
    streamingEnabled: true,
    providers: [a, b],
    labelCandidates: ["个人"],
    modelCandidates: ["model-A"],
  };
  return { a, b, view };
}

describe("现有 AI 候选项查找", () => {
  it("仅在编辑中的地址内查找去除首尾空格的标签，不激活候选项", () => {
    const { a, view } = fixture();
    expect(
      findExistingItem(view, { kind: "key", provider: a }, " 个人 "),
    ).toEqual({
      kind: "key",
      provider: a,
      item: a.keys[0],
    });
    expect(view.activeProviderId).toBe("b");
  });
  it("排除正在编辑的项并保留模型 ID 的大小写敏感性", () => {
    const { a, view } = fixture();
    expect(
      findExistingItem(
        view,
        { kind: "model", provider: a, item: a.models[0] },
        "model-A",
      ),
    ).toBeNull();
    expect(
      findExistingItem(
        view,
        { kind: "key", provider: a, item: a.keys[0] },
        "个人",
      ),
    ).toBeNull();
    expect(
      findExistingItem(view, { kind: "model", provider: a }, "model-a"),
    ).toBeNull();
    expect(
      findExistingItem(view, { kind: "model", provider: a }, " model-A ")?.kind,
    ).toBe("model");
  });
  it("使用最新快照，绝不把其他地址的候选项视为重复项", () => {
    const { a, view } = fixture();
    view.providers = [{ ...a, keys: [], models: [] }, view.providers[1]];
    expect(
      findExistingItem(view, { kind: "key", provider: a }, "个人"),
    ).toBeNull();
    expect(
      findExistingItem(view, { kind: "model", provider: a }, "model-A"),
    ).toBeNull();
    view.providers = [];
    expect(
      findExistingItem(view, { kind: "key", provider: a }, "个人"),
    ).toBeNull();
    expect(findExistingItem(view, { kind: "provider" }, "model-A")).toBeNull();
  });
});
