// @vitest-environment happy-dom
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mobilePoetryEntry } from "~/features/poetry/back-navigation";
import { poetryReadingSession } from "~/features/poetry/reading-session";

import { createBackController } from "./back-controller";
import { trackBackHistory } from "./back-history";
import { fallbackBackLink } from "./back-target";
import { navigationContext } from "./navigation-context";

const cleanups: (() => void)[] = [];

async function setup(
  history: RouterHistory = createMemoryHistory({ initialEntries: ["/"] }),
) {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: "$" });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history,
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const view = createRoot(document.createElement("div"));
  await act(async () => {
    view.render(createElement(RouterProvider, { router }));
  });
  cleanups.push(() => {
    act(() => view.unmount());
  });
  const controller = createBackController(router);
  cleanups.push(controller.dispose, () => history.destroy());
  const navigate = (options: {
    to: string;
    search?: Record<string, unknown>;
    replace?: boolean;
  }) =>
    act(async () => {
      await router.navigate({ ...options, search: () => options.search ?? {} });
    });
  return { router, controller, navigate };
}

afterEach(() => {
  poetryReadingSession.setState({ location: null });
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("移动返回遵循页面层级", () => {
  it("主导航恢复作品时建立列表父级，可滑回列表而非前一个 Tab", async () => {
    const { router, controller, navigate } = await setup();
    await navigate({ to: "/settings" });
    poetryReadingSession.setState({
      location: { page: "detail", uid: "poem-1", q: "春", view: "translation" },
    });
    const entry = mobilePoetryEntry()!;
    await act(async () => {
      await router.navigate({ ...entry.parent, replace: true });
      await router.navigate(entry.destination);
    });
    expect(controller.canSwipe()).toBe(true);
    await act(async () => {
      controller.back();
    });
    expect(router.state.location.pathname).toBe("/library");
    expect(router.state.location.search).toEqual({ q: "春" });
    expect(controller.back()).toBe(false);
  });

  it("一级页即使有旧工具历史也请求回桌面", async () => {
    const { router, controller, navigate } = await setup();
    await navigate({ to: "/tools/crypto" });
    await navigate({ to: "/" });
    const back = vi.spyOn(router.history, "back");
    expect(controller.back()).toBe(false);
    expect(controller.canSwipe()).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it("多个主导航替换后，子页只返回当前主导航", async () => {
    const { router, controller, navigate } = await setup();
    await navigate({ to: "/library", replace: true });
    await navigate({ to: "/settings", replace: true });
    expect(router.history.length).toBe(1);
    await navigate({ to: "/settings", search: { panel: "ai" } });
    expect(controller.canSwipe()).toBe(true);
    expect(controller.back()).toBe(true);
    await router.load();
    expect(router.state.location.pathname).toBe("/settings");
    expect(router.state.location.search).toEqual({});
    expect(controller.back()).toBe(false);
  });

  it("作品管理与活动逐级返回时保留阅读查询", async () => {
    const { router, controller, navigate } = await setup();
    await navigate({
      to: "/library",
      search: { q: "春" },
      replace: true,
    });
    await navigate({
      to: "/library/poem-1",
      search: { q: "春", view: "annotations" },
    });
    await navigate({
      to: "/library/manage",
      search: { poem: "poem-1", q: "春", view: "annotations", from: "detail" },
    });
    await navigate({ to: "/activity" });
    controller.back();
    await router.load();
    expect(router.state.location.pathname).toBe("/library/manage");
    controller.back();
    await router.load();
    expect(router.state.location.pathname).toBe("/library/poem-1");
    expect(router.state.location.search).toEqual({
      q: "春",
      view: "annotations",
    });
  });

  it("直接打开详情没有已知历史时替换到合理父级", async () => {
    const { router, controller } = await setup(
      createMemoryHistory({ initialEntries: ["/library/poem-1?q=spring"] }),
    );
    expect(controller.canSwipe()).toBe(false);
    controller.back();
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe("/library"),
    );
    expect(router.state.location.search).toEqual({ q: "spring" });
    expect(router.history.length).toBe(1);
  });

  it("实际浏览器历史的离开守卫可以阻止返回", async () => {
    window.history.replaceState(null, "", "/");
    const history = createBrowserHistory({ window });
    const { router, controller, navigate } = await setup(history);
    await navigate({ to: "/tools/crypto" });
    history.flush();
    const blocker = vi.fn(() => true);
    cleanups.push(history.block({ blockerFn: blocker }));
    controller.back();
    await vi.waitFor(() => expect(blocker).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe("/tools/crypto");
  });

  it("后退尚未提交时连续按键只发起一次", async () => {
    const { router, controller, navigate } = await setup();
    await navigate({ to: "/tools/crypto" });
    const back = vi.spyOn(router.history, "back").mockImplementation(() => {});
    controller.back();
    controller.back();
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("导航上下文与无历史父级", () => {
  it("详情参数而非路径、底栏可见性决定层级", () => {
    expect(navigationContext("/settings", {}, false)?.primary).toBe(true);
    for (const panel of ["ai", "data", "features", "mcp"])
      expect(navigationContext("/settings", { panel }, false)?.primary).toBe(
        false,
      );
    expect(navigationContext("/library", { poem: "p" }, false)?.primary).toBe(
      false,
    );
  });

  it("关联设置和活动详情保留明确返回上下文", () => {
    expect(
      fallbackBackLink("/settings", {
        returnUid: "p",
        returnQ: "spring",
        returnView: "translation",
      }),
    ).toMatchObject({
      to: "/library/$id",
      params: { id: "p" },
      search: { q: "spring", view: "translation" },
    });
    expect(fallbackBackLink("/activity", { operation: "op" })).toEqual({
      to: "/activity",
      search: { tab: "logs" },
    });
    expect(fallbackBackLink("/games/go", {})).toEqual({
      to: "/",
      search: { category: "games" },
    });
  });

  it("不能从重新进入的一级页穿越到之前的子页", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const tracked = trackBackHistory(
      history,
      (location) => location.pathname === "/",
    );
    cleanups.push(tracked.dispose, () => history.destroy());
    history.push("/tools/crypto");
    history.push("/");
    expect(tracked.previous()).toBeUndefined();
    history.push("/tools/todo");
    expect(tracked.previous()?.pathname).toBe("/");
  });
});
