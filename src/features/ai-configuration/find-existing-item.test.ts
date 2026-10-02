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

describe("existing AI candidate lookup", () => {
  it("locates a trimmed label only within the edited address without activating it", () => {
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
  it("excludes the item being edited and preserves model ID case sensitivity", () => {
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
  it("uses the latest snapshot and never treats another address's candidate as a duplicate", () => {
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
