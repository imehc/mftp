import { useEffect, useState } from "react";

export const FALLBACK_BOARD_ACCENT = 0x1d7561;

function resolvePrimaryColor(): number {
  if (typeof document === "undefined") return FALLBACK_BOARD_ACCENT;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !value) return FALLBACK_BOARD_ACCENT;
  // CSS 主题使用 oklch，由浏览器完成颜色转换，避免各棋盘自行解析。
  context.fillStyle = "#1d7561";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return (red << 16) | (green << 8) | blue;
}

export function useBoardAccentColor(): number {
  const [color, setColor] = useState(resolvePrimaryColor);
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setColor(resolvePrimaryColor()),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return color;
}
