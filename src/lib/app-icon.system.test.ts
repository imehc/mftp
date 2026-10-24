// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const { setIcon } = vi.hoisted(() => ({ setIcon: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setIcon }),
}));

afterEach(() => {
  document.head.innerHTML = "";
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("系统图标由原生资源管理", () => {
  it.each(["windows", "macos", "linux", "android", "ios", "web"])(
    "%s 应用外观仅改变 favicon，不监听或替换系统图标",
    async (platform) => {
      const fetchIcon = vi.fn();
      const matchMedia = vi.fn();
      vi.stubGlobal("__MFTP_PLATFORM__", platform);
      vi.stubGlobal("fetch", fetchIcon);
      vi.stubGlobal("matchMedia", matchMedia);
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
      document.head.innerHTML =
        '<link id="app-favicon" href="/app-light-icon.png" />';
      const icons = await import("./app-icon");
      icons.applyAppIcon("dark");
      expect(document.querySelector("#app-favicon")?.getAttribute("href")).toBe(
        "/app-dark-icon.png",
      );
      icons.applyAppIcon("light");
      expect(document.querySelector("#app-favicon")?.getAttribute("href")).toBe(
        "/app-light-icon.png",
      );
      expect(icons).not.toHaveProperty("installSystemAppIcon");
      expect(icons).not.toHaveProperty("applyDesktopWindowIcon");
      expect(matchMedia).not.toHaveBeenCalled();
      expect(fetchIcon).not.toHaveBeenCalled();
      expect(setIcon).not.toHaveBeenCalled();
    },
  );
});
