import { describe, expect, it } from "vitest";

import { resolvePoetryReadingView } from "./reading-view";

describe("诗词阅读链接兼容", () => {
  it("旧白话和文学链接及设置返回参数均恢复到译文视图", () => {
    expect(resolvePoetryReadingView(undefined, "literal")).toBe("translation");
    expect(resolvePoetryReadingView(undefined, "literary")).toBe("translation");
  });

  it("显式视图优先，不会被旧参数强制切回译文", () => {
    expect(resolvePoetryReadingView("original", "literary")).toBe("original");
    expect(resolvePoetryReadingView("translation")).toBe("translation");
  });

  it("无效参数不创建新的风格或视图", () => {
    expect(resolvePoetryReadingView("literary", "other")).toBeUndefined();
    expect(resolvePoetryReadingView(null, ["literal"])).toBeUndefined();
    expect(resolvePoetryReadingView(undefined)).toBeUndefined();
  });
});
