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
 * Route guard (`beforeLoad`) for desktop-only tools: redirects to home on
 * mobile so hidden entries can't be reached by URL or stale "last tool" state.
 */
export function desktopOnlyGuard(): void {
  if (isMobilePlatform()) {
    throw redirect({ to: "/" });
  }
}
