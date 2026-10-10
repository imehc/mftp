export const displayScales = [0.75, 1.25] as const;
// 旧倍率仍可读取，避免升级后悄悄改变用户字号；新控件只展示 displayScales。
const supportedScales = [0.875, 1, 1.125, ...displayScales] as const;

export type DisplaySize = {
  mode: "system" | "manual";
  scale: (typeof supportedScales)[number];
};

export function resolveDisplaySize(value: unknown): DisplaySize {
  const size =
    value && typeof value === "object"
      ? (value as { mode?: unknown; scale?: unknown })
      : {};
  return {
    mode: size.mode === "manual" ? "manual" : "system",
    scale: supportedScales.includes(size.scale as DisplaySize["scale"])
      ? (size.scale as DisplaySize["scale"])
      : size.scale === 1.5
        ? 1.25
        : 1,
  };
}

export function applyDisplaySize(value: unknown) {
  const size = resolveDisplaySize(value);
  // 系统模式不计算设备倍率，保留浏览器/WebView 自己的默认字号与缩放。
  if (size.mode === "system")
    document.documentElement.style.removeProperty("--ui-scale");
  else
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(size.scale),
    );
}

export function applyStoredDisplaySize() {
  try {
    const raw = localStorage.getItem("mftp-settings");
    applyDisplaySize(raw ? JSON.parse(raw)?.state?.displaySize : undefined);
  } catch {
    applyDisplaySize(undefined);
  }
}
