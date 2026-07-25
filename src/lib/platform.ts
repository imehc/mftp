/**
 * Platform detection for gating desktop-only features (updater, autostart).
 * Works without the os plugin: Tauri mobile webviews report Android/iOS in
 * the user agent.
 */
export function isMobilePlatform(): boolean {
  return /android|iphone|ipad/i.test(navigator.userAgent);
}

export function isDesktopPlatform(): boolean {
  return !isMobilePlatform();
}
