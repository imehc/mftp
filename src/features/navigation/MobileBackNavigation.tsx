import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { listenMobileBack } from "~/lib/events";
import { mobileNavigationConfigure } from "~/lib/ipc";
import { isIosPlatform, isMobilePlatform } from "~/lib/platform";

import { createBackController } from "./back-controller";
import { installMobileBackTransitions } from "./mobile-back-transition";
import { useNativeBackGuards } from "./native-back-guard";
import { createNavigationSync } from "./native-navigation-sync";

const configureNavigation = createNavigationSync(mobileNavigationConfigure);

// Radix 在 Portal 中渲染浮层，不能只查询页面主体。
const OVERLAY_SELECTOR = [
  "dialog",
  "alert-dialog",
  "sheet",
  "popover",
  "dropdown-menu",
  "dropdown-menu-sub",
  "context-menu",
  "select",
]
  .map((slot) => `[data-slot="${slot}-content"][data-state="open"]`)
  .join(",");

export function MobileBackNavigation() {
  const router = useRouter();
  useEffect(() => {
    if (!isMobilePlatform() || !("__TAURI_INTERNALS__" in window)) return;
    const controller = createBackController(router);
    const stopTransitions = installMobileBackTransitions(router);
    const root = document.documentElement;
    const ios = isIosPlatform();
    let disposed = false;
    let last = "";

    function sync() {
      if (disposed) return;
      root.dataset.mobileNavigation = controller.isPrimary()
        ? "root"
        : "detail";
      if (!ios) return;
      const enabled =
        controller.canSwipe() &&
        useNativeBackGuards.getState().active.size === 0 &&
        !document.querySelector(OVERLAY_SELECTOR);
      const href = window.location.href;
      const key = `${enabled}:${href}`;
      if (key === last) return;
      last = key;
      // 串行配置并丢弃过期快照，防止较慢的启用响应覆盖新页面的禁用状态。
      void configureNavigation({ enabled, href }).catch((error) => {
        last = "";
        console.error("Native navigation configuration failed", error);
      });
    }

    const stopBack = listenMobileBack(() => {
      const handled = controller.back();
      sync();
      return handled;
    });
    const stopHistory = router.history.subscribe(sync);
    const stopResolved = router.subscribe("onResolved", sync);
    const stopGuards = useNativeBackGuards.subscribe(sync);
    const observer = new MutationObserver(sync);
    if (ios)
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-state"],
      });
    sync();
    return () => {
      disposed = true;
      delete root.dataset.mobileNavigation;
      observer.disconnect();
      stopGuards();
      stopResolved();
      stopHistory();
      stopBack();
      stopTransitions();
      controller.dispose();
      if (ios)
        void configureNavigation({
          enabled: false,
          href: window.location.href,
        }).catch(console.error);
    };
  }, [router]);
  return null;
}
