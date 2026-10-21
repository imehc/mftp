// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionDownloadButton } from "./CollectionManagement";

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

async function renderButton(props: {
  count: number;
  disabled: boolean;
  onDownload: () => void;
}) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <CollectionDownloadButton {...props} />
      </I18nProvider>,
    );
  });
}

function button() {
  return container.querySelector<HTMLButtonElement>("button");
}

describe("合集下载按钮", () => {
  it("显示选择数量并在未选择时禁用", async () => {
    const onDownload = vi.fn();
    await renderButton({ count: 0, disabled: true, onDownload });
    expect(button()?.disabled).toBe(true);
    expect(button()?.textContent).toContain("下载所选");
    expect(button()?.textContent).toContain("0");
    expect(button()?.getAttribute("aria-label")).toBe("下载所选");
  });

  it("有选择时点击触发下载", async () => {
    const onDownload = vi.fn();
    await renderButton({ count: 3, disabled: false, onDownload });
    expect(button()?.disabled).toBe(false);
    expect(button()?.textContent).toContain("3");
    await act(async () => button()?.click());
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("加载或同步期间保持禁用", async () => {
    await renderButton({ count: 2, disabled: true, onDownload: vi.fn() });
    expect(button()?.disabled).toBe(true);
  });
});
