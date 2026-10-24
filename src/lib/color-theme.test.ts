import { afterEach, expect, it, vi } from "vitest";

import { applyCjkFont, resolveCjkFont } from "./color-theme";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("未收录的中文字体回退系统默认", () => {
  expect(resolveCjkFont(undefined)).toBe("system");
  expect(resolveCjkFont("")).toBe("system");
  expect(resolveCjkFont("songti")).toBe("system");
  expect(resolveCjkFont("pixel")).toBe("pixel");
});

it("选中文字体写入 data-cjk，系统默认只清理属性", () => {
  const attributes = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
  });
  applyCjkFont("wenkai");
  expect(attributes.get("data-cjk")).toBe("wenkai");
  applyCjkFont("system");
  expect(attributes.has("data-cjk")).toBe(false);
});
