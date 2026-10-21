const ACTIVITY_PATH = "/activity";

function normalizePathname(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

/** 活动页是全屏页；离开时丢弃本次内存日志，与桌面关闭面板一致。 */
export function isLeavingActivityPath(
  previousPathname: string,
  pathname: string,
) {
  return (
    normalizePathname(previousPathname) === ACTIVITY_PATH &&
    normalizePathname(pathname) !== ACTIVITY_PATH
  );
}

/** 面板内的模态弹窗优先消费 Esc；活动面板自身是非模态 dialog，不算拦截目标。 */
export function isInsideModalDialog(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest('[role="dialog"]:not([aria-modal="false"])') !== null
  );
}
