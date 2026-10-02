import { describe, expect, it } from "vitest";
import type { AiConfigurationView } from "~/bindings";
import { hasAiRequestSelection } from "./request-readiness";

function configuration(): AiConfigurationView {
  return {
    revision: 1,
    activeProviderId: "a",
    streamingEnabled: true,
    labelCandidates: [],
    modelCandidates: [],
    providers: ["a", "b"].map((id) => ({
      id,
      name: id,
      baseUrl: `https://${id}.example.invalid/v1`,
      revision: 1,
      requiresAddressRepair: false,
      currentKeyId: `${id}-key`,
      currentModelId: `${id}-model`,
      keys: [{ id: `${id}-key`, label: "qa", state: "savedUnverified" }],
      models: [{ id: `${id}-model`, modelId: "qa-model", displayName: null }],
    })),
  };
}

describe("AI request selection", () => {
  it("accepts a saved reference without claiming its credential has been authenticated", () => {
    expect(hasAiRequestSelection(configuration())).toBe(true);
  });

  it("uses only the active address's own key and model", () => {
    const view = configuration();
    view.providers[0].currentKeyId = "b-key";
    expect(hasAiRequestSelection(view)).toBe(false);
    view.providers[0].currentKeyId = "a-key";
    view.providers[0].currentModelId = "b-model";
    expect(hasAiRequestSelection(view)).toBe(false);
    view.activeProviderId = "b";
    expect(hasAiRequestSelection(view)).toBe(true);
  });

  it("rejects missing credentials, invalid addresses and incomplete selections", () => {
    const cases: ((view: AiConfigurationView) => void)[] = [
      (view) => {
        view.activeProviderId = null;
      },
      (view) => {
        view.activeProviderId = "unknown";
      },
      (view) => {
        view.providers[0].requiresAddressRepair = true;
      },
      (view) => {
        view.providers[0].baseUrl = " ";
      },
      (view) => {
        view.providers[0].currentKeyId = null;
      },
      (view) => {
        view.providers[0].keys[0].state = "missing";
      },
      (view) => {
        view.providers[0].currentModelId = null;
      },
      (view) => {
        view.providers[0].models[0].modelId = " ";
      },
    ];
    for (const change of cases) {
      const view = configuration();
      change(view);
      expect(hasAiRequestSelection(view)).toBe(false);
    }
  });
});
