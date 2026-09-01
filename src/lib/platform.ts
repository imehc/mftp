/**
 * 平台检测，用于限制仅桌面端可用的功能（更新器、开机自启）。
 * 不依赖 os 插件也能工作：Tauri 移动端 webview 会在 user agent 中
 * 上报 Android/iOS。
 */
import { redirect } from "@tanstack/react-router";

export function isMobilePlatform(): boolean {
  return /android|iphone|ipad/i.test(navigator.userAgent);
}

export function isDesktopPlatform(): boolean {
  return !isMobilePlatform();
}

/**
 * 仅桌面端工具的路由守卫（`beforeLoad`）：在移动端重定向回首页，
 * 避免通过 URL 或残留的“上次工具”状态访问到被隐藏的入口。
 */
export function desktopOnlyGuard(): void {
  if (isMobilePlatform()) {
    throw redirect({ to: "/" });
  }
}
