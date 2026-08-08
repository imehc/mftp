export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Drop the decimal past 100 so the column width stays put: 1.5 GB, 17.2 GB, 999 GB.
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
