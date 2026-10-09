import { afterEach, expect, it, vi } from "vitest";

import { applyStoredAppearance } from "./initial-appearance";

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(saved: string | null, systemDark: boolean, denied = false) {
  const classes = new Set(["dark", "other"]);
  const root = {
    classList: {
      remove: (...values: string[]) =>
        values.forEach((value) => classes.delete(value)),
      add: (value: string) => classes.add(value),
    },
    style: { colorScheme: "" },
  };
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: systemDark }) });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      expect(key).toBe("theme");
      if (denied) throw new Error("Storage unavailable");
      return saved;
    },
  });
  return { root, classes };
}

it("首屏使用已保存的明暗模式，保留其他根元素类名", () => {
  for (const theme of ["light", "dark"]) {
    const { root, classes } = setup(theme, theme !== "dark");
    applyStoredAppearance();
    expect([...classes]).toEqual(["other", theme]);
    expect(root.style.colorScheme).toBe(theme);
  }
});

it("系统模式、缺失或损坏偏好都采用系统明暗模式", () => {
  for (const saved of ["system", null, "invalid"]) {
    for (const systemDark of [true, false]) {
      const { root } = setup(saved, systemDark);
      applyStoredAppearance();
      expect(root.style.colorScheme).toBe(systemDark ? "dark" : "light");
    }
  }
});

it("存储访问被拒绝时仍可初始化系统主题", () => {
  const { root } = setup(null, false, true);
  expect(() => applyStoredAppearance()).not.toThrow();
  expect(root.style.colorScheme).toBe("light");
});
