import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { formatDuration } from "./format";

describe("formatDuration", () => {
  beforeEach(() => {
    i18n.loadAndActivate({ locale: "zh-CN", messages: {} });
  });

  it("格式化秒、分钟和小时", () => {
    expect(formatDuration(5)).toBe("5 秒");
    expect(formatDuration(65)).toBe("1 分 5 秒");
    expect(formatDuration(3600)).toBe("1 小时");
    expect(formatDuration(3660)).toBe("1 小时 1 分");
  });

  it("无效值显示占位符", () => {
    expect(formatDuration(Number.NaN)).toBe("--");
    expect(formatDuration(-1)).toBe("--");
  });
});
