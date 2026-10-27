import type { AnyRouter, RouterHistory } from "@tanstack/react-router";

import { isMobilePlatform } from "~/lib/platform";

import { useNativeBackGuards } from "./native-back-guard";

type Navigate = () => void | Promise<void>;

type ViewTransitionOptions = Exclude<
  NonNullable<AnyRouter["options"]["defaultViewTransition"]>,
  boolean
>;

const transitions = new WeakMap<
  AnyRouter,
  (href: string, navigate: Navigate, animate: boolean) => void
>();

/** 只有显式按钮返回能创建过渡意图，系统手势和普通路由不进入此路径。 */
export function runMobileBackTransition(
  router: AnyRouter,
  href: string,
  navigate: Navigate,
  animate = true,
) {
  const run = transitions.get(router);
  if (run) run(href, navigate, animate);
  else void navigate();
}

export function installMobileBackTransitions(router: AnyRouter) {
  // Router 在不支持 types 的旧浏览器会退为全局动画，因此必须同时检测。
  if (
    !isMobilePlatform() ||
    typeof document.startViewTransition !== "function" ||
    !window.CSS?.supports?.("selector(:active-view-transition-type(back))")
  )
    return () => {};

  const previous = router.options.defaultViewTransition;
  let intent: { from: string; to: string } | undefined;
  let pending = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    intent = undefined;
    pending = false;
    clearTimeout(timeout);
  }

  const options: ViewTransitionOptions = {
    types: ({ fromLocation, toLocation, hrefChanged }) => {
      const next = intent;
      intent = undefined;
      return next &&
        hrefChanged &&
        fromLocation?.href === next.from &&
        toLocation.href === next.to &&
        useNativeBackGuards.getState().active.size === 0 &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? ["mobile-back"]
        : false;
    },
  };
  router.update({ defaultViewTransition: options });
  const history: RouterHistory = router.history;
  const stopHistory = history.subscribe(({ location }) => {
    if (!intent) return;
    if (location.href !== intent.to) clear();
    // 已得到真实导航事件后允许慢加载；未发生导航的请求则由超时清理。
    else clearTimeout(timeout);
  });
  const stopResolved = router.subscribe("onResolved", clear);

  const run = (href: string, navigate: Navigate, animate: boolean) => {
    if (pending || router.state.status !== "idle") return;
    pending = true;
    if (
      animate &&
      useNativeBackGuards.getState().active.size === 0 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      intent = { from: router.state.location.href, to: href };
    timeout = setTimeout(clear, 1500);
    try {
      const result = navigate();
      // replace 导航被守卫拦截时没有 history 通知，但 navigate 会完成。
      if (result) void result.then(clear, clear);
    } catch (error) {
      clear();
      throw error;
    }
  };

  transitions.set(router, run);
  return () => {
    clear();
    stopHistory();
    stopResolved();
    if (transitions.get(router) === run) transitions.delete(router);
    if (router.options.defaultViewTransition === options)
      router.update({ defaultViewTransition: previous });
  };
}
