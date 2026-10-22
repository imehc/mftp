// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

// 下拉浮层依赖指针事件与 Portal，这里换成同名占位组件，只验证设置项与写入结果。
vi.mock("~/components/ui/dropdown-menu", () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Container,
    DropdownMenuLabel: Container,
    DropdownMenuSub: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuContent: ({ children }: { children: ReactNode }) => (
      <div data-slot="menu">{children}</div>
    ),
    DropdownMenuSubTrigger: ({
      children,
      disabled,
    }: {
      children: ReactNode;
      disabled?: boolean;
    }) => (
      <button type="button" disabled={disabled}>
        {children}
      </button>
    ),
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
  };
});

import TransferSetting from "./TransferSetting";

const platform = vi.hoisted(() => ({ supported: true }));

vi.mock("~/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/platform")>()),
  rsyncSupportedPlatform: () => platform.supported,
}));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  platform.supported = true;
  useSettingsStore.setState({
    directoryTransferMode: "archive",
    rsyncDeleteExtraneous: false,
  });
  useTransfersStore.setState({
    transfers: [],
    dismissed: new Set(),
    runtimeError: undefined,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderSetting() {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <TransferSetting />
      </I18nProvider>,
    );
  });
}

function text() {
  return container.textContent ?? "";
}

function menuItem(label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-slot="menu"] button'),
  ).find((item) => item.textContent === label);
}

function triggerLabel() {
  return (
    container.querySelector<HTMLElement>("#settings-transfer")?.textContent ??
    ""
  );
}

async function click(label: string) {
  const item = menuItem(label);
  if (!item) throw new Error(`未找到菜单项：${label}`);
  await act(async () => item.click());
}

describe("文件传输设置", () => {
  it("模式选项与增量同步的删除策略收在同一菜单", async () => {
    await renderSetting();
    expect(text()).toContain("文件传输");
    expect(menuItem("压缩包")).toBeDefined();
    expect(menuItem("直连")).toBeDefined();
    expect(menuItem("增量同步(rsync)")).toBeDefined();
    expect(text()).toContain("目标多余文件");
    expect(menuItem("保留")).toBeDefined();
    expect(menuItem("删除")).toBeDefined();
    // 删除策略不再单独占一行设置。
    expect(container.querySelectorAll('[data-slot="field"]')).toHaveLength(1);
  });

  it("选择二级策略同时切换到增量同步", async () => {
    await renderSetting();
    await click("删除");
    expect(useSettingsStore.getState().directoryTransferMode).toBe("rsync");
    expect(useSettingsStore.getState().rsyncDeleteExtraneous).toBe(true);
    expect(triggerLabel()).toBe("增量同步(rsync)");
    await click("保留");
    expect(useSettingsStore.getState().rsyncDeleteExtraneous).toBe(false);
    expect(triggerLabel()).toBe("增量同步(rsync)");
  });

  it("切换模式后触发器显示对应名称", async () => {
    await renderSetting();
    expect(triggerLabel()).toBe("压缩包");
    await click("直连");
    expect(useSettingsStore.getState().directoryTransferMode).toBe("direct");
    expect(triggerLabel()).toBe("直连");
  });

  it("平台不支持时保留已保存方式并明确提示", async () => {
    platform.supported = false;
    useSettingsStore.setState({ directoryTransferMode: "rsync" });
    await renderSetting();
    expect(text()).toContain("当前平台不支持增量同步。");
    expect(menuItem("增量同步(当前平台不可用)")).toBeDefined();
    expect(text()).not.toContain("目标多余文件");
  });

  it("传输进行中禁用设置项", async () => {
    useTransfersStore.getState().start("sftp", "上传 project");
    await renderSetting();
    expect(menuItem("压缩包")?.disabled).toBe(true);
    expect(menuItem("直连")?.disabled).toBe(true);
  });
});
