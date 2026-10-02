// 媒体压缩专用工具；通用的文件选择 / 保存与路径工具在 ~/lib/files，
// 字节格式化在 ~/lib/format。

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** 正数表示比原文件小；负数表示更大；未知为 null。 */
export function sizeDeltaPercent(
  originalBytes: number,
  resultBytes: number,
): number | null {
  if (
    !Number.isFinite(originalBytes) ||
    !Number.isFinite(resultBytes) ||
    originalBytes <= 0
  ) {
    return null;
  }
  return Math.round(((originalBytes - resultBytes) / originalBytes) * 100);
}
