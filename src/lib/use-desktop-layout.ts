import { useMediaQuery } from "./use-media-query";

// 布局只看 CSS 视口宽度，原生能力仍由 platform.ts 判断。
// 与 Tailwind 默认 md（48rem）保持一致；媒体查询的 rem 不随应用根字号缩放。
export const DESKTOP_LAYOUT_QUERY = "(min-width: 48rem)";

export function useDesktopLayout(): boolean {
  return useMediaQuery(DESKTOP_LAYOUT_QUERY);
}
