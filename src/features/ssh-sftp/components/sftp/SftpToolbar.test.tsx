// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SftpToolbar from "./SftpToolbar";

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

async function renderToolbar() {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <SftpToolbar
          cwd="/root"
          loading={false}
          busy={false}
          onHome={vi.fn()}
          onParent={vi.fn()}
          onRefresh={vi.fn()}
          onCreate={vi.fn()}
          onUpload={vi.fn()}
          onUploadDir={vi.fn()}
          sort={{ key: "name", direction: "asc" }}
          onSort={vi.fn()}
        />
      </I18nProvider>,
    );
  });
}

function toolbarButton(label: string) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
}

describe("文件目录行操作", () => {
  it("新建与上传以纯图标放在目录行右侧", async () => {
    await renderToolbar();

    expect(toolbarButton("新建")?.textContent).toBe("");
    expect(toolbarButton("上传")?.textContent).toBe("");
    const buttons = Array.from(container.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label"),
    );
    expect(buttons.indexOf("刷新")).toBeLessThan(buttons.indexOf("新建"));
    expect(buttons.indexOf("新建")).toBeLessThan(buttons.indexOf("上传"));
  });

  it("上传菜单不再重复提供新建入口", async () => {
    await renderToolbar();
    const upload = toolbarButton("上传");
    if (!upload) throw new Error("找不到上传按钮");

    await act(async () => {
      upload.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      upload.click();
      for (let index = 0; index < 8; index++) await Promise.resolve();
    });

    const labels = Array.from(
      document.querySelectorAll("[role='menuitem']"),
    ).map((item) => item.textContent?.trim());
    expect(labels).toEqual(["上传文件", "上传文件夹"]);
  });
});
