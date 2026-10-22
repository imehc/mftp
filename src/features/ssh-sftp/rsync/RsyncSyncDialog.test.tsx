// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RsyncPreview } from "~/types";

import RsyncSyncDialog, { type RsyncPreviewState } from "./RsyncSyncDialog";

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function state(patch: Partial<RsyncPreviewState> = {}): RsyncPreviewState {
  return {
    requestId: "1",
    direction: "upload",
    localDir: "/Users/me/project",
    remoteDir: "/srv/project",
    displayName: "project",
    deleteExtraneous: false,
    preview: null,
    loading: false,
    error: null,
    ...patch,
  };
}

function preview(patch: Partial<RsyncPreview> = {}): RsyncPreview {
  return {
    token: "token",
    direction: "upload",
    localDir: "/Users/me/project",
    remoteDir: "/srv/project",
    deleteExtraneous: false,
    added: 2,
    updated: 1,
    deleted: 1,
    items: [
      { kind: "added", path: "a.txt", isDir: false },
      { kind: "updated", path: "docs", isDir: true },
      { kind: "deleted", path: "old.txt", isDir: false },
    ],
    truncated: false,
    ...patch,
  };
}

async function renderDialog(
  value: RsyncPreviewState | null,
  handlers: {
    onOpenChange?: (open: boolean) => void;
    onRetry?: () => void;
    onConfirm?: () => void;
  } = {},
) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <RsyncSyncDialog
          state={value}
          onOpenChange={handlers.onOpenChange ?? (() => {})}
          onRetry={handlers.onRetry ?? (() => {})}
          onConfirm={handlers.onConfirm ?? (() => {})}
        />
      </I18nProvider>,
    );
  });
}

function text() {
  return document.body.textContent ?? "";
}

function button(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
}

describe("rsync 同步确认弹窗", () => {
  it("预览期间显示检测状态且不能开始同步", async () => {
    await renderDialog(state({ loading: true }));
    expect(text()).toContain("正在检测 rsync 并生成同步预览…");
    expect(button("开始同步")?.disabled).toBe(true);
  });

  it("展示新增更新删除数量、策略与待删除警告", async () => {
    await renderDialog(
      state({
        deleteExtraneous: true,
        preview: preview({ deleteExtraneous: true }),
      }),
    );
    expect(text()).toContain("新增 2");
    expect(text()).toContain("更新 1");
    expect(text()).toContain("删除 1");
    expect(text()).toContain("目标多余文件：删除");
    expect(text()).toContain("确认后将删除远端目标中源端不存在的 1 项内容。");
    expect(text()).toContain("a.txt");
    expect(text()).toContain("docs/");
    expect(button("开始同步")?.disabled).toBe(false);
  });

  it("目标已是最新时不提供开始同步", async () => {
    await renderDialog(
      state({
        preview: preview({ added: 0, updated: 0, deleted: 0, items: [] }),
      }),
    );
    expect(text()).toContain("目标已是最新");
    expect(button("开始同步")?.disabled).toBe(true);
  });

  it("预览失败只提供重新预览，并说明尚未写入", async () => {
    const onRetry = vi.fn();
    await renderDialog(
      state({
        error: {
          kind: "custom",
          code: "rsync:preview_expired",
          message: "rsync preview is no longer valid",
          args: {},
        },
      }),
      { onRetry },
    );
    expect(text()).toContain("同步预览已过期，请重新预览");
    expect(text()).toContain("本次操作尚未执行任何写入。");
    expect(button("开始同步")).toBeUndefined();
    await act(async () => button("重新预览")?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("确认使用当前预览", async () => {
    const onConfirm = vi.fn();
    await renderDialog(state({ preview: preview() }), { onConfirm });
    await act(async () => button("开始同步")?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
