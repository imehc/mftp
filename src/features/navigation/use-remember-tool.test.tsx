// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ModuleId, ToolRoute } from "~/lib/module-metadata";
import { useSettingsStore as store } from "~/store/settings";

import { useRememberPage, useRememberTool } from "./use-remember-tool";

function Page({ page }: { page: ModuleId }) {
  useRememberPage(page);
  return null;
}

function Tool({ tool }: { tool: ToolRoute }) {
  useRememberTool(tool);
  return null;
}

let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.setState(store.getInitialState(), true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("小游戏挂载后记录页面，切换到其他游戏后更新记录", async () => {
  for (const page of ["billiards", "gomoku", "go", "xiangqi"] as const) {
    await act(async () => root.render(<Page page={page} />));
    expect(store.getState().lastPage).toBe(page);
  }
});

it("工具和文库挂载后接入同一页面记录，卸载不清空记录", async () => {
  for (const tool of ["translation", "library"] as const) {
    await act(async () => root.render(<Tool tool={tool} />));
    expect(store.getState().lastPage).toBe(tool);
  }
  await act(async () => root.render(null));
  expect(store.getState().lastPage).toBe("library");
});
