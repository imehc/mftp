// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as zhMessages } from "~/locales/zh-CN/messages";

const navigation = vi.hoisted(() => ({
  canGoBack: true,
  back: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useCanGoBack: () => navigation.canGoBack,
  useRouter: () => ({
    history: { back: navigation.back },
    navigate: navigation.navigate,
  }),
}));
vi.mock("~/components/ToolPageHeader", () => ({
  ToolPageHeader: ({
    title,
    leading,
  }: {
    title: ReactNode;
    leading: ReactNode;
  }) => (
    <header>
      {leading}
      <h1>{title}</h1>
    </header>
  ),
}));
vi.mock("./use-activity-logs", () => ({
  useActivityLogs: () => ({
    error: null,
    loading: false,
    filtered: [],
    source: "all",
    result: "all",
    range: "all",
  }),
}));
vi.mock("./LogFilters", () => ({ default: () => null }));
vi.mock("./LogDialogs", () => ({ default: () => null }));

import ActivityLogsPage from "./ActivityLogsPage";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.clearAllMocks();
  navigation.canGoBack = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("zh-CN", zhMessages);
  i18n.activate("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderAndBack() {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ActivityLogsPage />
      </I18nProvider>,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="返回"]')
      ?.click(),
  );
}

describe("历史日志返回上下文", () => {
  it("从活动日志或设置进入历史页后返回原历史项", async () => {
    await renderAndBack();
    expect(navigation.back).toHaveBeenCalledOnce();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("直接进入历史页时无历史记录才回到设置", async () => {
    navigation.canGoBack = false;
    await renderAndBack();
    expect(navigation.back).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith({ to: "/settings" });
  });
});
