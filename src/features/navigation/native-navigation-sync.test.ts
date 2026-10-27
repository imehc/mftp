import { describe, expect, it, vi } from "vitest";

import { createNavigationSync } from "./native-navigation-sync";

describe("原生手势状态同步", () => {
  it("丢弃过期的启用并串行提交最新禁用", async () => {
    let release!: () => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const sync = createNavigationSync(send);
    const first = sync({ enabled: true, href: "/detail" });
    await Promise.resolve();
    void sync({ enabled: true, href: "/other" });
    const last = sync({ enabled: false, href: "/" });
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, last]);
    expect(send.mock.calls).toEqual([
      [{ enabled: true, href: "/detail" }],
      [{ enabled: false, href: "/" }],
    ]);
  });

  it("旧实例清理不会覆盖新实例启用，失败后仍可同步", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(undefined);
    const sync = createNavigationSync(send);
    await expect(sync({ enabled: true, href: "/a" })).rejects.toThrow(
      "unavailable",
    );
    const cleanup = sync({ enabled: false, href: "/a" });
    const remount = sync({ enabled: true, href: "/b" });
    await Promise.all([cleanup, remount]);
    expect(send).toHaveBeenLastCalledWith({ enabled: true, href: "/b" });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
