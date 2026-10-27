import type { AnyRouter } from "@tanstack/react-router";

import { useSettingsStore } from "~/store/settings";

import { trackBackHistory } from "./back-history";
import { fallbackBackLink } from "./back-target";
import { navigationContext } from "./navigation-context";

export function createBackController(router: AnyRouter) {
  const history = router.history;
  const primary = () =>
    navigationContext(
      history.location.pathname,
      router.options.parseSearch!(history.location.search),
      useSettingsStore.getState().showGames,
    )?.primary === true;
  const tracker = trackBackHistory(
    history,
    (location) =>
      navigationContext(
        location.pathname,
        router.options.parseSearch!(location.search),
        useSettingsStore.getState().showGames,
      )?.primary === true,
  );
  let pending = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function release() {
    pending = false;
    clearTimeout(timeout);
  }

  const unlisten = history.subscribe(release);
  return {
    isPrimary: primary,
    canSwipe: () =>
      !primary() &&
      !!tracker.previous() &&
      !pending &&
      router.state.status === "idle" &&
      router.state.location.href === history.location.href,
    back() {
      if (pending || router.state.status !== "idle") return true;
      if (primary()) return false;
      pending = true;
      // 浏览器后退没有 Promise；无 popstate 的边界也必须能恢复下一次操作。
      timeout = setTimeout(release, 1000);
      if (tracker.previous()) history.back();
      else {
        const search = router.options.parseSearch!(history.location.search);
        void router
          .navigate({
            ...fallbackBackLink(history.location.pathname, search),
            replace: true,
          })
          .finally(release);
      }
      return true;
    },
    dispose() {
      release();
      unlisten();
      tracker.dispose();
    },
  };
}
