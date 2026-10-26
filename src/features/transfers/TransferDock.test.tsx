// @vitest-environment happy-dom

import { i18n, setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type TransferState, useTransfersStore } from "~/store/transfers";
import type { TransferProgress } from "~/types";

import TransferDock, { hideAt } from "./TransferDock";

// store 里的 phase 文案走全局 i18n，未激活 locale 会直接抛错。
i18n.load("zh-CN", {});
i18n.activate("zh-CN");
// happy-dom 默认不声明 act 环境；不设会打印噪音警告。
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 传输坞在 happy-dom 里也要观察高度；没有尺寸时上报 0，不影响断言。
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function transfer(patch: Partial<TransferState> = {}): TransferState {
  return {
    id: "t1",
    label: "上传 report.zip",
    phase: "上传中",
    kind: "upload",
    startedAt: 0,
    transferred: 50,
    total: 100,
    speed: null,
    updatedAt: 0,
    status: "running",
    ...patch,
  };
}

function progress(patch: Partial<TransferProgress> = {}): TransferProgress {
  return {
    id: "t1",
    phase: "上传中",
    transferred: 50,
    total: 100,
    finished: false,
    ...patch,
  } as TransferProgress;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useTransfersStore.setState({ transfers: [], dismissed: new Set() });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useTransfersStore.setState({ transfers: [], dismissed: new Set() });
});

function render() {
  const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });
  act(() => {
    root.render(
      <I18nProvider i18n={i18n}>
        <TransferDock />
      </I18nProvider>,
    );
  });
}

describe("传输坞", () => {
  it("没有任务时不渲染任何浮层", () => {
    render();
    expect(container.innerHTML).toBe("");
  });

  it("运行中的上传显示文件名、进度和取消", () => {
    act(() => {
      useTransfersStore.getState().start("t1", "上传 report.zip", {
        kind: "upload",
      });
      useTransfersStore.getState().updateProgressBatch([progress()]);
    });
    render();
    expect(container.textContent).toContain("上传 report.zip");
    expect(container.textContent).toContain("50%");
    expect(container.querySelector('[aria-label="取消"]')).not.toBeNull();
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it("失败任务常驻并提供重试和关闭", () => {
    act(() => {
      useTransfersStore.getState().start("t1", "上传 backup.tar", {
        kind: "upload",
        retry: { kind: "sftp-action", run: async () => undefined },
      });
      useTransfersStore.getState().finish("t1", "error", {
        kind: "custom",
        code: "sftp:io_error",
        message: "连接已断开",
        args: {},
      });
    });
    render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("重试");
    expect(container.querySelector('[aria-label="关闭"]')).not.toBeNull();
  });

  it("多个任务时汇总数量", () => {
    act(() => {
      useTransfersStore
        .getState()
        .start("t1", "上传 a.zip", { kind: "upload" });
      useTransfersStore.getState().start("t2", "下载 b.zip", {
        kind: "download",
      });
    });
    render();
    expect(container.textContent).toContain("2 个传输中");
  });
});

describe("传输坞的保留时长", () => {
  it("运行中与失败任务不自动消失", () => {
    expect(hideAt(transfer({ status: "running" }))).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(hideAt(transfer({ status: "error" }))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("成功任务在停留时长后过期", () => {
    expect(hideAt(transfer({ status: "success", finishedAt: 1000 }))).toBe(
      3500,
    );
  });

  it("秒传也至少可见最小时长，避免闪烁", () => {
    expect(
      hideAt(
        transfer({
          status: "cancelled",
          startedAt: 1000,
          finishedAt: 1000,
        }),
      ),
    ).toBe(2500);
  });
});
