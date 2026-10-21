// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PoetryCollectionStatus } from "~/types";

import type { PoetrySyncProgressState } from "../sync-progress";
import PoetrySyncStatus from "./PoetrySyncStatus";

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const baseProgress: PoetrySyncProgressState = {
  active: false,
  stale: false,
  collectionId: null,
  phase: null,
  bytesDone: 0,
  bytesTotal: null,
  imported: 0,
  total: null,
  error: null,
  updatedAt: 0,
};

const collections: PoetryCollectionStatus[] = [
  {
    id: "tang",
    name: "全唐诗",
    dynasty: "唐",
    script: "simplified",
    tier: "default",
    installed: false,
    poemCount: 300,
    bytesUsed: 0,
    sourceSha: "abc",
  },
];

let root: Root;
let container: HTMLDivElement;
const onCancel = vi.fn(async () => undefined);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onCancel.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderStatus(
  props: Partial<ComponentProps<typeof PoetrySyncStatus>> = {},
) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <PoetrySyncStatus
          progress={baseProgress}
          collections={collections}
          onCancel={onCancel}
          {...props}
        />
      </I18nProvider>,
    );
  });
}

function buttonByText(text: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
}

describe("诗词同步状态块", () => {
  it("下载中显示合集、进度与取消", async () => {
    await renderStatus({
      progress: {
        ...baseProgress,
        active: true,
        collectionId: "tang",
        phase: "downloading",
        bytesDone: 512,
        bytesTotal: 1024,
        updatedAt: 1,
      },
    });
    expect(container.textContent).toContain("正在下载");
    expect(container.textContent).toContain("全唐诗");
    expect(container.textContent).toContain("50%");
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    const cancel = buttonByText("取消同步");
    await act(async () => cancel?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("启动中与等待确认显示对应状态", async () => {
    await renderStatus({ starting: true });
    expect(container.textContent).toContain("正在启动");

    await renderStatus({
      progress: { ...baseProgress, active: true, stale: true, updatedAt: 2 },
    });
    expect(container.textContent).toContain("等待确认");
  });

  it("失败显示错误并可关闭，新错误再次出现", async () => {
    const error = {
      kind: "external" as const,
      code: "poetry:sync_failed",
      message: "disk full",
      args: {},
    };
    // 进入页面时已存在的终态视为已读，只在挂载后收到新错误时提示。
    await renderStatus();
    await renderStatus({
      progress: {
        ...baseProgress,
        collectionId: "tang",
        phase: "error",
        error,
        updatedAt: 10,
      },
    });
    expect(container.textContent).toContain("同步失败");
    expect(container.textContent).toContain("disk full");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭同步失败提示"]',
    );
    expect(close).not.toBeNull();
    await act(async () => close?.click());
    expect(container.textContent).not.toContain("同步失败");

    await renderStatus({
      progress: {
        ...baseProgress,
        collectionId: "tang",
        phase: "error",
        error,
        updatedAt: 11,
      },
    });
    expect(container.textContent).toContain("同步失败");
  });

  it("主动取消和已完成不显示状态块", async () => {
    await renderStatus({
      progress: {
        ...baseProgress,
        phase: "error",
        error: {
          kind: "custom",
          code: "poetry:sync_cancelled",
          message: "cancelled",
          args: {},
        },
        updatedAt: 20,
      },
    });
    expect(container.textContent).toBe("");

    await renderStatus({
      progress: { ...baseProgress, phase: "done", updatedAt: 21 },
    });
    expect(container.textContent).toBe("");
  });
});
