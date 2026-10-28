// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LightNotice, LightNoticeStack } from "./LightNotice";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("新消息替换旧消息后，旧计时器不会提前关闭新消息", async () => {
  await act(async () =>
    root.render(<LightNotice notice={{ id: "a", message: "旧提示" }} />),
  );
  await act(async () => vi.advanceTimersByTime(2500));
  await act(async () =>
    root.render(<LightNotice notice={{ id: "b", message: "新提示" }} />),
  );
  await act(async () => vi.advanceTimersByTime(700));
  expect(host.textContent).toBe("新提示");
  expect(host.querySelector("span")?.getAttribute("aria-hidden")).toBe("false");
  await act(async () => vi.advanceTimersByTime(2300));
  expect(host.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
  await act(async () => vi.advanceTimersByTime(150));
  expect(host.textContent).toBe("");
});

it("同一规则消失后再次成立会重新展示，卸载清理计时器", async () => {
  const notice = { id: "rule", message: "自由球" };
  await act(async () => root.render(<LightNoticeStack notices={[notice]} />));
  await act(async () => vi.advanceTimersByTime(3200));
  expect(host.textContent).toBe("");
  await act(async () => root.render(<LightNoticeStack notices={[]} />));
  await act(async () => root.render(<LightNoticeStack notices={[notice]} />));
  expect(host.textContent).toBe("自由球");
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(host);
});
