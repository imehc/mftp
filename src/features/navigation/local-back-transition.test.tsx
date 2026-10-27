// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { runLocalBackTransition } from "./local-back-transition";

vi.mock("~/lib/platform", () => ({ isMobilePlatform: () => true }));

const original = document.startViewTransition;

afterEach(() => {
  document.startViewTransition = original;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function transitions() {
  vi.stubGlobal("CSS", { supports: () => true });
  const start = vi.fn((options: { update: () => void }) => {
    const done = Promise.resolve().then(options.update);
    return {
      ready: done,
      finished: done,
      updateCallbackDone: done,
      skipTransition: vi.fn(),
    };
  });
  document.startViewTransition = start as unknown as typeof original;
  return start;
}

it("关闭页内详情的更新只执行一次，新快照前已提交 React 页面", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const start = transitions();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<p>详情</p>));
  const update = vi.fn(() => root.render(<p>列表</p>));
  await act(async () => runLocalBackTransition(update));
  expect(start).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("列表");
  await act(async () => root.unmount());
});

it("关闭弹窗不误做成整页返回动画", () => {
  const start = transitions();
  document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
  const update = vi.fn();
  runLocalBackTransition(update);
  expect(update).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
});

it("键盘关闭页内详情保持即时更新", () => {
  const start = transitions();
  const update = vi.fn();
  runLocalBackTransition(update, false);
  expect(update).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
});

it("连续页内返回先取消旧过渡，每个页面操作只执行一次", async () => {
  const start = transitions();
  const first = vi.fn();
  const second = vi.fn();
  runLocalBackTransition(first);
  runLocalBackTransition(second);
  await Promise.resolve();
  expect(start.mock.results[0]!.value.skipTransition).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});
