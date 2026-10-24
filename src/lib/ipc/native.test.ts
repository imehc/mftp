import { beforeEach, describe, expect, it, vi } from "vitest";

const { commitEnvironment } = vi.hoisted(() => ({
  commitEnvironment: vi.fn(),
}));

vi.mock("~/bindings", () => ({
  commands: { modelEnvironmentCommit: commitEnvironment },
}));

import { modelEnvironmentCommit } from "./native";

beforeEach(() => {
  commitEnvironment.mockReset();
});

describe("原生能力 IPC 门面", () => {
  it("拆分后既有原生资源命令仍按空返回值处理", async () => {
    commitEnvironment.mockResolvedValue({ status: "ok", data: null });
    await expect(
      modelEnvironmentCommit("environment-id"),
    ).resolves.toBeUndefined();
    expect(commitEnvironment).toHaveBeenCalledExactlyOnceWith("environment-id");
  });
});
