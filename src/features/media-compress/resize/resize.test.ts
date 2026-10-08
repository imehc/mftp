import { describe, expect, it } from "vitest";

import {
  computeTargetSize,
  isTargetSizeAllowed,
  type ResizeOptions,
} from "./resize";

const options: ResizeOptions = {
  method: "ratio",
  ratio: 50,
  dimensionMode: "exact",
  width: null,
  height: null,
  edge: null,
};

describe("媒体尺寸设置", () => {
  it("比例模式与固定宽度保留宽高比", () => {
    const source = { width: 800, height: 600 };
    expect(computeTargetSize(source, options)).toEqual({
      width: 400,
      height: 300,
    });
    expect(
      computeTargetSize(source, {
        ...options,
        method: "dimension",
        dimensionMode: "width",
        width: 200,
      }),
    ).toEqual({ width: 200, height: 150 });
  });

  it("切换尺寸模式后缺少必要输入时不产生可执行尺寸", () => {
    expect(
      computeTargetSize(
        { width: 800, height: 600 },
        { ...options, method: "dimension", width: 400 },
      ),
    ).toBeNull();
    expect(
      computeTargetSize(
        { width: 800, height: 600 },
        { ...options, method: "dimension", width: 400, height: 200 },
      ),
    ).toEqual({ width: 400, height: 200 });
  });

  it("按最小边缩放时校验另一边的画布上限", () => {
    const target = computeTargetSize(
      { width: 8000, height: 100 },
      { ...options, method: "dimension", dimensionMode: "shortest", edge: 200 },
    );
    expect(target).toEqual({ width: 16000, height: 200 });
    expect(isTargetSizeAllowed(target!)).toBe(false);
    expect(isTargetSizeAllowed({ width: 0, height: 10 })).toBe(false);
  });
});
