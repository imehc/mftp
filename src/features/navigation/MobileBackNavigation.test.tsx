// @vitest-environment happy-dom
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { mobileNavigationConfigure } from "~/lib/ipc";

import { BackLink } from "./BackLink";
import { MobileBackNavigation } from "./MobileBackNavigation";
import { useNativeBackGuards } from "./native-back-guard";

vi.mock("~/lib/ipc", () => ({
  mobileNavigationConfigure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/platform", async (original) => ({
  ...(await original<typeof import("~/lib/platform")>()),
  isMobilePlatform: () => true,
  isIosPlatform: () => true,
}));

const cleanups: (() => void)[] = [];

afterEach(async () => {
  await act(async () => cleanups.splice(0).forEach((cleanup) => cleanup()));
  useNativeBackGuards.setState({ active: new Set() });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function setup(initialPath = "/") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  window.history.replaceState(null, "", initialPath);
  const history = createBrowserHistory({ window });
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <MobileBackNavigation />
        <Outlet />
      </>
    ),
  });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => <BackLink to="/">返回父级</BackLink>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const view = createRoot(container);
  cleanups.push(
    () => view.unmount(),
    () => history.destroy(),
    () => container.remove(),
  );
  await act(async () => view.render(<RouterProvider router={router} />));
  const navigate = (href: string) =>
    act(async () => {
      await router.navigate({ href });
    });
  return { router, navigate };
}

function enableViewTransitions(supportsTypes = true) {
  const original = document.startViewTransition;
  vi.stubGlobal("CSS", { supports: vi.fn(() => supportsTypes) });
  const start = vi.fn(
    (options: { update: () => Promise<void>; types: string[] }) => {
      const done = Promise.resolve().then(options.update);
      return {
        updateCallbackDone: done,
        ready: done,
        finished: done,
        skipTransition: vi.fn(),
      };
    },
  );
  document.startViewTransition = start as unknown as typeof original;
  cleanups.push(() => {
    document.startViewTransition = original;
  });
  return start;
}

async function clickBack(detail = 1) {
  await act(async () => {
    document.querySelector("a")!.dispatchEvent(
      new MouseEvent("click", {
        button: 0,
        detail,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

it("真实路由提交后才启用原生手势，浮层和业务守卫立即禁用", async () => {
  const { navigate } = await setup();
  const configure = vi.mocked(mobileNavigationConfigure);
  expect(configure).toHaveBeenLastCalledWith({
    enabled: false,
    href: window.location.href,
  });
  await navigate("/tools/crypto");
  await vi.waitFor(() =>
    expect(configure).toHaveBeenLastCalledWith({
      enabled: true,
      href: window.location.href,
    }),
  );

  const overlay = document.createElement("div");
  overlay.dataset.slot = "dialog-content";
  overlay.dataset.state = "open";
  document.body.append(overlay);
  await vi.waitFor(() =>
    expect(configure).toHaveBeenLastCalledWith({
      enabled: false,
      href: window.location.href,
    }),
  );
  overlay.remove();
  await vi.waitFor(() =>
    expect(configure).toHaveBeenLastCalledWith({
      enabled: true,
      href: window.location.href,
    }),
  );

  useNativeBackGuards.setState({ active: new Set([Symbol()]) });
  await vi.waitFor(() =>
    expect(configure).toHaveBeenLastCalledWith({
      enabled: false,
      href: window.location.href,
    }),
  );
  useNativeBackGuards.setState({ active: new Set() });
  await vi.waitFor(() =>
    expect(configure).toHaveBeenLastCalledWith({
      enabled: true,
      href: window.location.href,
    }),
  );
  await navigate("/settings");
  expect(document.documentElement.dataset.mobileNavigation).toBe("root");
  await vi.waitFor(() =>
    expect(configure).toHaveBeenLastCalledWith({
      enabled: false,
      href: window.location.href,
    }),
  );
});

it("系统返回按键在子页消费，在一级页留给原生退后台", async () => {
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  const back = new KeyboardEvent("keydown", {
    key: "BrowserBack",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    document.dispatchEvent(back);
  });
  expect(back.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  const rootBack = new KeyboardEvent("keydown", {
    key: "BrowserBack",
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(rootBack);
  expect(rootBack.defaultPrevented).toBe(false);
});

it("点击父级返回链接消费原有历史，不追加返回后又进入子页的记录", async () => {
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  const index = router.history.location.state.__TSR_index;
  await act(async () => {
    document
      .querySelector("a")!
      .dispatchEvent(
        new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }),
      );
  });
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(router.history.location.state.__TSR_index).toBe(index - 1);
});

it("移动端点按返回在真实路由提交时播放一次返回过渡", async () => {
  const transition = enableViewTransitions();
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  expect(transition).not.toHaveBeenCalled();
  const index = router.history.location.state.__TSR_index;
  await clickBack();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(router.history.location.state.__TSR_index).toBe(index - 1);
  expect(transition).toHaveBeenCalledTimes(1);
  expect(transition.mock.calls[0]![0].types).toEqual(["mobile-back"]);
});

it("原生系统历史返回不叠加网页过渡", async () => {
  const transition = enableViewTransitions();
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  await act(async () => router.history.back());
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(transition).not.toHaveBeenCalled();
});

it("没有有效来源时替换到父级也能播放返回过渡", async () => {
  const transition = enableViewTransitions();
  const { router } = await setup("/tools/crypto");
  const index = router.history.location.state.__TSR_index;
  await clickBack();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(router.history.location.state.__TSR_index).toBe(index);
  expect(transition).toHaveBeenCalledTimes(1);
});

it("被离开守卫拒绝的返回不会冻结页面或污染下一次导航", async () => {
  const transition = enableViewTransitions();
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  const blocked = vi.fn(() => true);
  const unblock = router.history.block({
    blockerFn: blocked,
    enableBeforeUnload: false,
  });
  cleanups.push(unblock);
  await clickBack();
  await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
  expect(router.state.location.pathname).toBe("/tools/crypto");
  expect(transition).not.toHaveBeenCalled();
  unblock();
  await navigate("/");
  expect(transition).not.toHaveBeenCalled();
});

it("快速连续点按返回只提交一次历史操作", async () => {
  const transition = enableViewTransitions();
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  const back = vi.spyOn(router.history, "back");
  await act(async () => {
    const anchor = document.querySelector("a")!;
    for (let i = 0; i < 2; i++)
      anchor.dispatchEvent(
        new MouseEvent("click", {
          button: 0,
          detail: 1,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(back).toHaveBeenCalledTimes(1);
  expect(transition).toHaveBeenCalledTimes(1);
});

it("键盘激活返回不播放页面位移动画", async () => {
  const transition = enableViewTransitions();
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  await clickBack(0);
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(transition).not.toHaveBeenCalled();
});

it("减少动态效果时返回不播放页面位移动画", async () => {
  const transition = enableViewTransitions();
  const original = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = original(query);
    if (query === "(prefers-reduced-motion: reduce)")
      Object.defineProperty(media, "matches", { value: true });
    return media;
  });
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  await clickBack();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(transition).not.toHaveBeenCalled();
});

it("旧浏览器不支持过渡类型时保持即时返回，不误开全局动画", async () => {
  const transition = enableViewTransitions(false);
  const { router, navigate } = await setup();
  await navigate("/tools/crypto");
  await clickBack();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(transition).not.toHaveBeenCalled();
  expect(router.options.defaultViewTransition).toBeUndefined();
});
