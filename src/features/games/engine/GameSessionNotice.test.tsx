// @vitest-environment happy-dom
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { frontendError } from "~/lib/errors";

import type { GameSessionStore } from "./game-session-store";
import { GameSessionNotice } from "./GameSessionNotice";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const restore = vi.fn();
const exit = vi.fn();
const load = vi.fn();
const retrySave = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(
  saved = true,
  error = false,
  onRestore = vi.fn(),
  overrides = {},
) {
  const snapshot = {
    status: error ? "error" : "ready",
    saved: saved ? { id: "隔离存档" } : null,
    error: error
      ? frontendError("games:checkpoint_read", "Checkpoint read failed")
      : null,
    transitioning: false,
    ...overrides,
  };
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    restore,
    exit,
    load,
    retrySave,
  } as unknown as GameSessionStore<unknown, unknown, unknown, unknown>;
  await act(async () =>
    root.render(
      <I18nProvider
        i18n={setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } })}
      >
        <GameSessionNotice store={store} onRestore={onRestore} />
      </I18nProvider>,
    ),
  );
}

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) =>
      item.textContent === label || item.getAttribute("aria-label") === label,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}

it("正常存档只显示恢复弹窗，继续时保留恢复前回调", async () => {
  const onRestore = vi.fn();
  await render(true, false, onRestore);
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  expect(document.querySelector('[data-slot="alert"]')).toBeNull();
  await click("继续游戏");
  expect(onRestore).toHaveBeenCalledOnce();
  expect(restore).toHaveBeenCalledOnce();
  expect(exit).not.toHaveBeenCalled();
});

it("读取存档时保留加载反馈", async () => {
  await render(false, false, undefined, { status: "loading" });
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "正在读取对局存档",
  );
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("自动保存中和保存成功均不渲染说明或预留提示行", async () => {
  await render(false, false, undefined, { saving: true });
  expect(host.innerHTML).toBe("");
  await render(false, false, undefined, {
    saving: false,
    savedAt: Date.now(),
  });
  expect(host.innerHTML).toBe("");
});

it("丢弃需要确认，取消和关闭均保留存档", async () => {
  await render();
  await click("丢弃存档");
  expect(exit).not.toHaveBeenCalled();
  await click("取消");
  await click("关闭");
  expect(navigate).toHaveBeenCalledWith({
    to: "/",
    search: { category: "games" },
  });
  expect(exit).not.toHaveBeenCalled();
  await click("丢弃存档");
  await click("确认");
  expect(exit).toHaveBeenCalledOnce();
});

it("读取失败时仍可重试，不伪装成正常恢复弹窗", async () => {
  await render(false, true);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector('[data-slot="alert"]')).not.toBeNull();
  await click("重试");
  expect(load).toHaveBeenCalledOnce();
  expect(restore).not.toHaveBeenCalled();
});
