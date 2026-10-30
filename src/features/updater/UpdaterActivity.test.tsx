// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialUpdaterState,
  type UpdaterState,
  useUpdaterStore,
} from "~/store/updater";

import UpdaterActivity from "./UpdaterActivity";

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
  vi.unstubAllGlobals();
});

async function renderActivity(state: Partial<UpdaterState>) {
  await act(async () => {
    useUpdaterStore.setState({ ...initialUpdaterState, ...state });
    root.render(
      <I18nProvider i18n={i18n}>
        <UpdaterActivity />
      </I18nProvider>,
    );
  });
}

function trigger() {
  return container.querySelector<HTMLButtonElement>("[data-updater-trigger]");
}

describe("活动中心更新卡片", () => {
  it.each(["idle", "current"] as const)(
    "状态 %s 不显示更新卡片",
    async (status) => {
      await renderActivity({ status });
      expect(trigger()).toBeNull();
    },
  );

  it("检查中和下载中保留活动卡片与进度", async () => {
    await renderActivity({ status: "checking" });
    expect(container.textContent).toContain("正在检查更新");

    await renderActivity({
      status: "downloading",
      phase: "downloading",
      downloaded: 512,
      total: 1024,
    });
    expect(container.textContent).toContain("下载中");
    expect(container.textContent).toContain("50%");
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it("可用更新展示版本，准备重启保留等待提示", async () => {
    await renderActivity({
      status: "available",
      version: "0.2.6",
      currentVersion: "0.2.5",
    });
    expect(container.textContent).toContain("发现新版本");
    expect(container.textContent).toContain("0.2.6");

    await renderActivity({
      status: "ready",
      version: "0.2.6",
      currentVersion: "0.2.5",
      phase: "verifying",
    });
    expect(container.textContent).toContain("等待重启");
  });

  it("错误状态保留错误说明，点击只打开更新弹窗", async () => {
    await renderActivity({
      status: "error",
      error: {
        kind: "external",
        code: "updater:check_failed",
        message: "Update check failed",
        args: {},
      },
    });
    const card = trigger();
    expect(container.textContent).toContain("更新未完成");
    expect(card?.getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => card?.click());
    expect(useUpdaterStore.getState().dialogOpen).toBe(true);
  });
});
