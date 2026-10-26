// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

import { useSessionsStore } from "~/store/sessions";
import type { Session } from "~/types";

import TabBar from "./TabBar";

const layout = vi.hoisted(() => ({ desktop: false }));
const toastMock = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("~/lib/use-desktop-layout", () => ({
  useDesktopLayout: () => layout.desktop,
}));
vi.mock("sonner", () => ({ toast: toastMock }));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const sessions: Session[] = [
  {
    id: "session-1",
    hostId: "host-1",
    title: "生产服务器",
    status: "connected",
    view: "terminal",
  },
  {
    id: "session-2",
    hostId: "host-2",
    title: "测试服务器",
    status: "connected",
    view: "sftp",
  },
];

let root: Root;
let container: HTMLDivElement;
let closeSession: Mock<(tabId: string) => Promise<void>>;
let onHosts: Mock<() => void>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  closeSession = vi.fn().mockResolvedValue(undefined);
  onHosts = vi.fn();
  layout.desktop = false;
  useSessionsStore.setState({
    sessions: sessions.map((session) => ({ ...session })),
    activeId: "session-1",
    closeSession,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

async function renderTabBar() {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <TabBar onHosts={onHosts} />
      </I18nProvider>,
    );
    await flush();
  });
}

async function click(target: Element) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    (target as HTMLElement).click();
    await flush();
  });
}

function buttonByLabel(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`找不到按钮 ${label}`);
  return button;
}

function menuItem(label: string) {
  const item = Array.from(
    document.querySelectorAll("[role='menuitem'], [role='menuitemradio']"),
  ).find((element) => element.textContent?.includes(label));
  if (!item) throw new Error(`找不到菜单项 ${label}`);
  return item;
}

describe("SSH 会话导航", () => {
  it("移动端只显示当前连接并保留关闭入口", async () => {
    await renderTabBar();

    expect(document.querySelector("[aria-label='选择连接']")).toBeNull();
    expect(container.textContent).toContain("生产服务器");
    expect(document.querySelector("[aria-label='连接视图']")).not.toBeNull();
    const closeButton = buttonByLabel("关闭连接");
    expect(closeButton.className).toContain("size-5");
    expect(closeButton.className).toContain("before:-inset-3");

    await click(closeButton);

    expect(closeSession).toHaveBeenCalledWith("session-1");
  });

  it("桌面标签关闭对应连接且视图切换保持可见", async () => {
    layout.desktop = true;
    await renderTabBar();

    const closeButtons = Array.from(
      document.querySelectorAll("button[aria-label='关闭连接']"),
    );
    expect(closeButtons).toHaveLength(2);
    expect(closeButtons[0].getAttribute("data-active")).toBe("true");
    expect(closeButtons[1].hasAttribute("data-active")).toBe(false);
    expect(closeButtons[1].className).toContain("opacity-0");
    const firstTab = document.querySelector(
      "[data-slot='context-menu-trigger']",
    );
    expect(firstTab?.className).toContain("w-fit");
    expect(firstTab?.className).toContain("flex-none");
    await click(closeButtons[1]);

    expect(closeSession).toHaveBeenCalledWith("session-2");
    expect(document.querySelector("[aria-label='连接视图']")).not.toBeNull();
  });

  it("桌面标签右键菜单提供主机列表入口", async () => {
    layout.desktop = true;
    await renderTabBar();
    const tab = document.querySelector("[data-slot='context-menu-trigger']");
    if (!tab) throw new Error("找不到连接标签");

    await act(async () => {
      tab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
      await flush();
    });
    await click(menuItem("打开主机列表"));

    expect(onHosts).toHaveBeenCalledTimes(1);
  });
});
