export const displayScales = [0.875, 1, 1.125, 1.25] as const;

export type DisplaySize = {
  mode: "system" | "manual";
  scale: (typeof displayScales)[number];
};

export function resolveDisplaySize(value: unknown): DisplaySize {
  const size =
    value && typeof value === "object" ? (value as Partial<DisplaySize>) : {};
  return {
    mode: size.mode === "manual" ? "manual" : "system",
    scale: displayScales.includes(size.scale as DisplaySize["scale"])
      ? (size.scale as DisplaySize["scale"])
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
