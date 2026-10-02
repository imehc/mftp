import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@dimforge/rapier2d-compat", () => ({ default: { init: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it("初始化期间复用请求，失败后允许显式重试", async () => {
  const { default: rapier } = await import("@dimforge/rapier2d-compat");
  let reject: (reason: Error) => void = () => undefined;
  vi.mocked(rapier.init).mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const { ensurePhysicsReady } = await import("./physics");
  const first = ensurePhysicsReady();
  expect(ensurePhysicsReady()).toBe(first);
  reject(new Error("WASM load failed"));
  await expect(first).rejects.toThrow("WASM load failed");
  vi.mocked(rapier.init).mockResolvedValueOnce(undefined);
  await expect(ensurePhysicsReady()).resolves.toBeUndefined();
  expect(rapier.init).toHaveBeenCalledTimes(2);
});
