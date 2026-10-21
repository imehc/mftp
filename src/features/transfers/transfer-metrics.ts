import { formatBytes, formatDuration } from "~/lib/format";
import type { TransferState } from "~/store/transfers";

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function transferMetrics(progress: TransferState) {
  const total = progress.total ?? 0;
  const percent =
    total > 0
      ? Math.min(100, Math.round((progress.transferred / total) * 100))
      : null;
  const speed = progress.speed && progress.speed > 0 ? progress.speed : null;
  const eta =
    progress.status === "running" && !progress.paused && total > 0 && speed
      ? formatDuration((total - progress.transferred) / speed)
      : null;
  return {
    percent,
    size:
      total > 0
        ? `${formatBytes(progress.transferred)} / ${formatBytes(total)}`
        : progress.transferred
          ? formatBytes(progress.transferred)
          : null,
    speed: speed ? formatSpeed(speed) : null,
    eta,
  };
}
