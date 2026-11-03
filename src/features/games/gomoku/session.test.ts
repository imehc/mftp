import { describe, expect, it } from "vitest";

import { createInitialGomokuState } from "./rules";
import { gomokuCheckpointSchema } from "./session";

const checkpoint = (version: number, mode: unknown) => ({
  version,
  gameId: "gomoku",
  id: crypto.randomUUID(),
  savedAt: 1,
  mode,
  history: [createInitialGomokuState()],
});

describe("五子棋存档兼容", () => {
  it.each([
    { kind: "hotseat" },
    { kind: "ai", difficulty: "medium", localSeat: 1 },
  ])("旧存档转换为第二版并保留局面和模式：%j", (mode) => {
    const old = checkpoint(1, mode);
    const upgraded = gomokuCheckpointSchema.parse(old);
    expect(upgraded).toEqual({ ...old, version: 2 });
    expect(gomokuCheckpointSchema.parse(upgraded)).toEqual(upgraded);
  });

  it("已移除的模型对局存档被拒绝，不自动转换为电脑", () => {
    const mode = {
      kind: "model_ai",
      localSeat: 0,
      target: {
        providerId: crypto.randomUUID(),
        modelId: crypto.randomUUID(),
        expectedBaseUrl: "https://example.test",
        expectedProtocol: "responses",
        expectedModel: "model",
      },
      providerName: "provider",
      modelName: "model",
    };
    expect(gomokuCheckpointSchema.safeParse(checkpoint(2, mode)).success).toBe(
      false,
    );
    expect(gomokuCheckpointSchema.safeParse(checkpoint(1, mode)).success).toBe(
      false,
    );
    expect(gomokuCheckpointSchema.safeParse(checkpoint(3, mode)).success).toBe(
      false,
    );
    expect(
      gomokuCheckpointSchema.safeParse(
        checkpoint(2, { ...mode, apiKey: "fake" }),
      ).success,
    ).toBe(false);
    expect(
      gomokuCheckpointSchema.safeParse(
        checkpoint(2, { ...mode, target: { ...mode.target, apiKey: "fake" } }),
      ).success,
    ).toBe(false);
  });
});
