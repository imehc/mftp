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

import {
  checkForUpdateManually,
  closeUpdaterDialog,
  restartToApplyUpdate,
  startUpdateDownload,
} from "./controller";
import UpdaterDialog from "./UpdaterDialog";

vi.mock("~/lib/platform", () => ({ isUpdaterPlatform: () => true }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./controller", () => ({
  checkForUpdateManually: vi.fn(),
  closeUpdaterDialog: vi.fn(() =>
    useUpdaterStore.setState({ dialogOpen: false }),
  ),
  restartToApplyUpdate: vi.fn(),
  startUpdateDownload: vi.fn(),
}));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  container.remove();
  useUpdaterStore.setState(initialUpdaterState);
  vi.unstubAllGlobals();
});

async function renderDialog(state: Partial<UpdaterState>) {
  await act(async () => {
    useUpdaterStore.setState({
      ...initialUpdaterState,
      dialogOpen: true,
      ...state,
    });
    root.render(
      <I18nProvider i18n={i18n}>
        <UpdaterDialog />
      </I18nProvider>,
    );
  });
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

function button(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((element) => element.textContent === label)!;
}

describe("更新弹窗", () => {
  it("检查提示只出现一次且正文与操作栏是独立布局区域", async () => {
    const dialog = await renderDialog({ status: "checking" });
    expect(dialog.textContent?.match(/正在检查更新/g)).toHaveLength(1);
    expect(
      Array.from(dialog.children).map((child) =>
        child.getAttribute("data-slot"),
      ),
    ).toEqual(["dialog-header", "dialog-layout-body", "dialog-footer"]);
    expect(
      dialog.querySelector('[data-slot="dialog-layout-body"] [role="status"]')
        ?.textContent,
    ).toContain("正在检查更新");
    expect(dialog.querySelector('[data-slot="separator"]')).toBeNull();
    expect(button("收起").dataset.density).toBe("adaptive");
    await act(async () => button("收起").click());
    expect(closeUpdaterDialog).toHaveBeenCalledOnce();
    expect(startUpdateDownload).not.toHaveBeenCalled();
    expect(checkForUpdateManually).not.toHaveBeenCalled();
  });

  it("最新版本结果在正文显示并保留当前版本说明", async () => {
    const dialog = await renderDialog({ status: "checking" });
    const title = dialog.querySelector(
      '[data-slot="dialog-title"]',
    )?.textContent;
    await act(async () =>
      useUpdaterStore.setState({ status: "current", currentVersion: "0.2.6" }),
    );
    expect(
      dialog.querySelector('[data-slot="dialog-title"]')?.textContent,
    ).toBe(title);
    expect(
      dialog.querySelector('[data-slot="dialog-layout-body"]')?.textContent,
    ).toBe("当前已是最新版本");
    expect(
      dialog.querySelector('[data-slot="dialog-description"]')?.textContent,
    ).toContain("0.2.6");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("0.2.6");
    expect(dialog.querySelector('[data-slot="separator"]')).toBeNull();
    await act(async () => button("完成").click());
    expect(closeUpdaterDialog).toHaveBeenCalledOnce();
  });

  it("可更新状态保留发布说明和下载入口", async () => {
    const dialog = await renderDialog({
      status: "available",
      version: "0.2.7",
      currentVersion: "0.2.6",
      releaseNotes: "# 更新说明\n- 改进检查更新",
    });
    const body = dialog.querySelector('[data-slot="dialog-layout-body"]');
    expect(body?.textContent).toContain("发现新版本");
    expect(body?.textContent).toContain("改进检查更新");
    expect(body?.textContent).toContain("查看完整发布说明");
    await act(async () => button("下载更新").click());
    expect(startUpdateDownload).toHaveBeenCalledOnce();
  });

  it("下载进度和长发布说明均位于唯一滚动正文", async () => {
    const dialog = await renderDialog({
      status: "downloading",
      version: "0.2.7",
      phase: "downloading",
      downloaded: 512,
      total: 1024,
      releaseNotes: "改进应用体验\n".repeat(100),
    });
    const body = dialog.querySelector('[data-slot="dialog-layout-body"]');
    expect(
      body
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("50");
    expect(body?.textContent).toContain("50%");
    expect(body?.textContent).toContain("改进应用体验");
    expect(body?.querySelector('[data-slot="dialog-footer"]')).toBeNull();
    expect(
      dialog.querySelector('[data-slot="dialog-footer"]')?.parentElement,
    ).toBe(dialog);
  });

  it.each([false, true])(
    "准备重启时保留安装状态与操作：已安装=%s",
    async (installed) => {
      const dialog = await renderDialog({
        status: "ready",
        version: "0.2.7",
        installed,
      });
      expect(dialog.querySelector('[role="status"]')?.textContent).toContain(
        installed ? "更新已安装" : "更新包已准备好",
      );
      expect(button("稍后重启")).toBeDefined();
      await act(async () => button("重启并更新").click());
      expect(restartToApplyUpdate).toHaveBeenCalledOnce();
    },
  );

  it("检查失败保留错误、发布页和重新检查入口", async () => {
    const dialog = await renderDialog({
      status: "error",
      error: {
        kind: "external",
        code: "updater:check_failed",
        message: "Network failed",
        args: {},
      },
    });
    const body = dialog.querySelector('[data-slot="dialog-layout-body"]');
    expect(body?.querySelector('[role="alert"]')?.textContent).toContain(
      "无法检查更新",
    );
    expect(body?.textContent).toContain("查看完整发布说明");
    await act(async () => button("重新检查").click());
    expect(checkForUpdateManually).toHaveBeenCalledOnce();
  });

  it("重启中状态不会因弹窗调整而丢失", async () => {
    const dialog = await renderDialog({
      status: "restarting",
      version: "0.2.7",
    });
    expect(
      dialog.querySelector('[data-slot="dialog-layout-body"] [role="status"]')
        ?.textContent,
    ).toContain("正在安装并重启");
    expect(button("收起")).toBeDefined();
  });

  it.each([false, true])(
    "准备重启失败时仍可重试：已安装=%s",
    async (installed) => {
      await renderDialog({
        status: "ready",
        version: "0.2.7",
        installed,
        error: {
          kind: "external",
          code: "updater:install_failed",
          message: "Install failed",
          args: {},
        },
      });
      await act(async () =>
        button(installed ? "重试重启" : "重试安装").click(),
      );
      expect(restartToApplyUpdate).toHaveBeenCalledOnce();
    },
  );

  it("关闭后将键盘焦点恢复到原检查入口", async () => {
    const trigger = document.createElement("button");
    trigger.dataset.updaterTrigger = "";
    vi.spyOn(trigger, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 44, 44),
    ] as unknown as DOMRectList);
    document.body.append(trigger);
    try {
      trigger.focus();
      await renderDialog({ status: "current", currentVersion: "0.2.6" });
      await act(async () => button("完成").click());
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      trigger.remove();
    }
  });
});
