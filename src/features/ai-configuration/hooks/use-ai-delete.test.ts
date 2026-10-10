import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiProviderView } from "~/bindings";
import { aiKeyDelete, aiModelDelete, aiProviderDelete } from "~/lib/ipc";

import { deleteAiTarget } from "./use-ai-delete";

vi.mock("~/lib/ipc", () => ({
  aiConfigurationGet: vi.fn(),
  aiModelSwitch: vi.fn(),
  aiKeyDelete: vi.fn(),
  aiModelDelete: vi.fn(),
  aiProviderDelete: vi.fn(),
}));

const provider: AiProviderView = {
  id: "p",
  name: "test",
  protocol: "responses",
  baseUrl: "https://example.invalid",
  revision: 3,
  requiresAddressRepair: false,
  currentKeyId: "k",
  currentModelId: "m",
  keys: [{ id: "k", label: "test", state: "savedUnverified" }],
  models: [{ id: "m", modelId: "remote-model", displayName: null }],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AI 删除请求分支", () => {
  it("删除地址只传地址与确认时的版本", async () => {
    await deleteAiTarget({ kind: "provider", provider }, 7, null);
    expect(aiProviderDelete).toHaveBeenCalledWith({
      providerId: "p",
      expectedRevision: 7,
    });
    expect(aiKeyDelete).not.toHaveBeenCalled();
    expect(aiModelDelete).not.toHaveBeenCalled();
  });

  it("删除密钥保留替代项且不携带凭据", async () => {
    await deleteAiTarget(
      { kind: "key", provider, item: provider.keys[0] },
      7,
      "next-key",
    );
    expect(aiKeyDelete).toHaveBeenCalledWith({
      providerId: "p",
      expectedRevision: 7,
      keyId: "k",
      replacementKeyId: "next-key",
    });
  });

  it("删除模型使用本地行标识并允许无替代项", async () => {
    await deleteAiTarget(
      { kind: "model", provider, item: provider.models[0] },
      7,
      null,
    );
    expect(aiModelDelete).toHaveBeenCalledWith({
      providerId: "p",
      expectedRevision: 7,
      id: "m",
      replacementModelId: null,
    });
  });

  it("冲突错误原样交回上层且不自动重放", async () => {
    const failure = {
      kind: "custom",
      code: "ai:revision_conflict",
      message: "Changed",
      args: {},
    };
    vi.mocked(aiProviderDelete).mockRejectedValue(failure);
    await expect(
      deleteAiTarget({ kind: "provider", provider }, 7, null),
    ).rejects.toBe(failure);
    expect(aiProviderDelete).toHaveBeenCalledTimes(1);
  });
});
