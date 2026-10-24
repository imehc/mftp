export type AppIconTheme = "light" | "dark";

export const appIconPaths: Readonly<Record<AppIconTheme, string>> = {
  light: "/app-light-icon.png",
  dark: "/app-dark-icon.png",
};

export function applyAppIcon(theme: AppIconTheme) {
  const link = document.querySelector<HTMLLinkElement>("#app-favicon");
  if (!link) return;

  const nextPath = appIconPaths[theme];
  if (link.getAttribute("href") !== nextPath) {
    link.setAttribute("href", nextPath);
  }
}
