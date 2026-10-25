// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useResetStore } from "~/features/about/reset-runtime";
import ResetBoundary from "~/features/about/ResetBoundary";
import { checkForUpdateOnLaunch } from "~/features/updater/integration";

import { AppRuntime } from "./AppRuntime";

vi.mock("~/features/updater/integration", () => ({
  checkForUpdateOnLaunch: vi.fn(),
}));
vi.mock("~/features/bt/integration", () => ({
  installBtRuntime: vi.fn(() => vi.fn()),
}));
vi.mock("~/features/games/engine/session-registry", () => ({
  installGameSessionRuntime: vi.fn(() => vi.fn()),
}));
vi.mock("~/features/model-viewer/system/inbox", () => ({
  installModelSystemRuntime: vi.fn(() => vi.fn()),
}));
vi.mock("~/features/poetry/sync-progress", () => ({
  installPoetrySyncRuntime: vi.fn(() => vi.fn()),
}));
vi.mock("~/features/transfers/runtime/transferRuntime", () => ({
  installTransferRuntime: vi.fn(() => vi.fn()),
}));
vi.mock("~/lib/app-icon", () => ({ applyAppIcon: vi.fn() }));
vi.mock("~/lib/color-theme", () => ({
  applyCjkFont: vi.fn(),
  applyColorTheme: vi.fn(),
  resolveCjkFont: vi.fn(),
  resolveColorTheme: vi.fn(),
}));
vi.mock("~/lib/display-size", () => ({ applyDisplaySize: vi.fn() }));
vi.mock("~/router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("~/store/settings", () => ({
  useSettingsStore: (
    selector: (state: {
      colorTheme: string;
      displaySize: string;
      cjkFont: string;
    }) => unknown,
  ) =>
    selector({
      colorTheme: "default",
      displaySize: "system",
      cjkFont: "system",
    }),
}));
vi.mock("~/features/about/reset-runtime", async () => {
  const { create } = await import("zustand");
  return {
    inspectReset: vi.fn(),
    startReset: vi.fn(),
    returnFromRejectedReset: vi.fn(),
    useResetStore: create(() => ({
      phase: "checking",
      progress: null,
      errors: [],
      failures: [],
      canReturn: false,
    })),
  };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
  useResetStore.setState({
    phase: "checking",
    progress: null,
    errors: [],
    failures: [],
    canReturn: false,
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

async function renderRuntime() {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ResetBoundary>
          <AppRuntime />
        </ResetBoundary>
      </I18nProvider>,
    ),
  );
}

it("确认无未完成重置后才启动自动更新，避免网络检查阻塞首屏", async () => {
  await renderRuntime();
  expect(checkForUpdateOnLaunch).not.toHaveBeenCalled();
  await act(async () => useResetStore.setState({ phase: "idle" }));
  expect(checkForUpdateOnLaunch).toHaveBeenCalledOnce();
});

it.each(["pending", "failed"] as const)(
  "重置状态为 %s 时不启动自动更新，手动检查恢复后才启动",
  async (phase) => {
    useResetStore.setState({ phase });
    await renderRuntime();
    expect(checkForUpdateOnLaunch).not.toHaveBeenCalled();
    await act(async () => useResetStore.setState({ phase: "checking" }));
    expect(checkForUpdateOnLaunch).not.toHaveBeenCalled();
    await act(async () => useResetStore.setState({ phase: "idle" }));
    expect(checkForUpdateOnLaunch).toHaveBeenCalledOnce();
  },
);
