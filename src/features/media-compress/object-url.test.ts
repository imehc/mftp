import { describe, expect, it, vi } from "vitest";

import { createObjectUrlOwner } from "./object-url";

describe("媒体 URL 所有权", () => {
  it("换源、清空与重复卸载各只释放已拥有的地址一次", () => {
    const api = {
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce("blob:a")
        .mockReturnValueOnce("blob:b"),
      revokeObjectURL: vi.fn(),
    };
    const owner = createObjectUrlOwner(api);
    expect(owner.replace(new Blob(["a"]))).toBe("blob:a");
    expect(owner.replace(new Blob(["b"]))).toBe("blob:b");
    expect(api.revokeObjectURL.mock.calls).toEqual([["blob:a"]]);
    expect(owner.replace(null)).toBeNull();
    owner.clear();
    owner.clear();
    expect(api.revokeObjectURL.mock.calls).toEqual([["blob:a"], ["blob:b"]]);
  });

  it("新地址分配失败时旧地址仍归原所有者管理", () => {
    const api = {
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce("blob:a")
        .mockImplementationOnce(() => {
          throw new Error("Allocation failed");
        }),
      revokeObjectURL: vi.fn(),
    };
    const owner = createObjectUrlOwner(api);
    owner.replace(new Blob());
    expect(() => owner.replace(new Blob())).toThrow("Allocation failed");
    expect(api.revokeObjectURL).not.toHaveBeenCalled();
    owner.clear();
    expect(api.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:a");
  });
});
