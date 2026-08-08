/**
 * Platform detection for gating desktop-only features (updater, autostart).
 * Works without the os plugin: Tauri mobile webviews report Android/iOS in
 * the user agent.
 */
import { redirect } from "@tanstack/react-router";

export function isMobilePlatform(): boolean {
  return /android|iphone|ipad/i.test(navigator.userAgent);
}

export function isDesktopPlatform(): boolean {
  return !isMobilePlatform();
}

/**
 * macOS detection. Same no-plugin approach as the mobile check: macOS
 * webviews report `Macintosh` in the user agent. Deliberately excludes iOS,
 * where iPad UAs also contain `Macintosh`.
 */
export function isMacPlatform(): boolean {
  return /macintosh|mac os x/i.test(navigator.userAgent) && !isMobilePlatform();
}

/**
 * Route guard (`beforeLoad`) for desktop-only tools: redirects to home on
 * mobile so hidden entries can't be reached by URL or stale "last tool" state.
 */
export function desktopOnlyGuard(): void {
  if (isMobilePlatform()) {
    throw redirect({ to: "/" });
  }
}

/**
 * Route guard for macOS-only tools. Stricter than `desktopOnlyGuard`: the
 * backend registers no `disk_clean_*` commands off macOS, so reaching the
 * page on Windows/Linux would fail at the IPC layer rather than degrade.
 */
export function macosOnlyGuard(): void {
  if (!isMacPlatform()) {
    throw redirect({ to: "/" });
  }
}
