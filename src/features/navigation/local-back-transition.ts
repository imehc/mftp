import { flushSync } from "react-dom";

import { isMobilePlatform } from "~/lib/platform";

let active: ViewTransition | undefined;

/** 仅供同步收起页内详情；异步取消任务必须先完成，再传入实际页面切换。 */
export function runLocalBackTransition(update: () => void, animate = true) {
  active?.skipTransition();
  if (
    !animate ||
    !isMobilePlatform() ||
    typeof document.startViewTransition !== "function" ||
    !window.CSS?.supports?.("selector(:active-view-transition-type(back))") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    )
  ) {
    update();
    return;
  }

  // View Transition 的新快照必须在 React 提交后拍摄；这里只同步局部返回。
  const transition = document.startViewTransition({
    types: ["mobile-back"],
    update: () => flushSync(update),
  });
  active = transition;
  void transition.ready.catch(() => {});
  void transition.finished.then(
    () => {
      if (active === transition) active = undefined;
    },
    (error) => {
      if (active === transition) active = undefined;
      console.error("Page return transition failed", error);
    },
  );
}
