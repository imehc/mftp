// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "~/locales/en/messages";
import { messages as zhMessages } from "~/locales/zh-CN/messages";

import {
  inspectReset,
  returnFromRejectedReset,
  startReset,
  useResetStore,
} from "./reset-runtime";
import ResetBoundary from "./ResetBoundary";

vi.mock("./reset-runtime", async () => {
  const { create } = await import("zustand");
  return {
    inspectReset: vi.fn(),
    startReset: vi.fn(),
    returnFromRejectedReset: vi.fn(),
    useResetStore: create(() => ({
      phase: "checking",
      progress: null,
      errors: [],
      failures: [],
      canReturn: false,
    })),
  };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("zh-CN", zhMessages);
  i18n.load("en", enMessages);
  i18n.activate("zh-CN");
  useResetStore.setState({
    phase: "checking",
    progress: null,
    errors: [],
    failures: [],
    canReturn: false,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderBoundary() {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ResetBoundary>
          <button>首页操作</button>
        </ResetBoundary>
      </I18nProvider>,
    ),
  );
}

describe("启动重置检查边界", () => {
  it("快速检查时不闪出检查文案，确认无重置后才挂载首页", async () => {
    await renderBoundary();
    expect(inspectReset).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("#reset-title")).toBeNull();
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => useResetStore.setState({ phase: "idle" }));
    expect(container.textContent).toBe("首页操作");
    await act(async () => vi.advanceTimersByTime(500));
    expect(container.textContent).not.toContain("正在检查重置状态");
  });

  it("慢检查只显示延迟加载图标，不显示重置标题或挂载业务页面", async () => {
    await renderBoundary();
    await act(async () => vi.advanceTimersByTime(299));
    expect(container.textContent).toBe("");
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(container.textContent).toBe("");
    expect(container.querySelector("#reset-title")).toBeNull();
    expect(container.textContent).not.toContain("首页操作");
    await act(async () => useResetStore.setState({ phase: "idle" }));
    expect(container.textContent).toBe("首页操作");
  });

  it("未完成重置立即进入恢复界面，不等待显示阈值", async () => {
    await renderBoundary();
    await act(async () =>
      useResetStore.setState({
        phase: "pending",
        progress: {
          id: "pending-reset",
          pending: ["credentials"],
          recordsDeleted: 1,
        },
      }),
    );
    expect(container.textContent).toContain("应用重置尚未完成");
    expect(container.textContent).toContain("继续完成重置");
    expect(container.textContent).not.toContain("首页操作");
    expect(document.activeElement).toBe(container.querySelector("main"));
    const resume = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "继续完成重置",
    );
    await act(async () => resume?.click());
    expect(startReset).toHaveBeenCalledWith(true);
  });

  it.each(["io:operation", "app:reset_state_invalid"])(
    "检查失败 %s 时保留错误与重试入口，不放行首页",
    async (code) => {
      await renderBoundary();
      await act(async () =>
        useResetStore.setState({
          phase: "failed",
          errors: [
            {
              kind: "external",
              code,
              message: "Synthetic startup failure",
              args: {},
            },
          ],
        }),
      );
      expect(container.textContent).toContain("暂时无法完成重置");
      expect(container.textContent).toContain("检查状态");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).not.toContain("首页操作");
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "检查状态",
      );
      await act(async () => retry?.click());
      expect(inspectReset).toHaveBeenCalledTimes(2);
      await act(async () => useResetStore.setState({ phase: "checking" }));
      expect(container.querySelector("#reset-title")?.textContent).toBe(
        "正在检查重置状态",
      );
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).not.toContain("首页操作");
    },
  );

  it("离开启动占位时清理计时器，再次检查不会沿用旧计时", async () => {
    await renderBoundary();
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => useResetStore.setState({ phase: "idle" }));
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => useResetStore.setState({ phase: "checking" }));
    await act(async () => vi.advanceTimersByTime(299));
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("启动状态名称跟随语言切换，图标遵循减少动画偏好", async () => {
    await renderBoundary();
    await act(async () => i18n.activate("en"));
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("Checking reset status");
    await act(async () => vi.advanceTimersByTime(300));
    expect(
      container
        .querySelector('[data-slot="spinner"]')
        ?.classList.contains("motion-reduce:animate-none"),
    ).toBe(true);
  });

  it("显式重置继续显示运行阶段，返回入口保留原行为", async () => {
    useResetStore.setState({ phase: "running" });
    await renderBoundary();
    expect(container.textContent).toContain("正在清理应用数据");
    expect(container.textContent).not.toContain("首页操作");
    await act(async () =>
      useResetStore.setState({ phase: "failed", canReturn: true }),
    );
    const back = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "返回应用",
    );
    await act(async () => back?.click());
    expect(returnFromRejectedReset).toHaveBeenCalledOnce();
  });
});
