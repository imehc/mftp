/** 与 next-themes 共用 theme 存储键，在 createRoot 前恢复明暗模式。 */
export function applyStoredAppearance() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {
    // 存储不可用时仍按系统模式初始化，避免停留在 HTML 默认的深色。
  }
  const theme =
    saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
}
