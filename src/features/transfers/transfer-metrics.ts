import { msg, plural } from "@lingui/core/macro";

import { translate } from "~/i18n/translate";
import { formatBytes } from "~/lib/format";
import type { TransferState } from "~/store/transfers";

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) {
    return translate(
      msg({
        message: plural(
          {
            rounded,
          },
          {
            one: "# 秒",
            other: "# 秒",
          },
        ),
      }),
    );
  }
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) {
    if (remainingSeconds > 0) {
      return translate(
        msg({
          message: plural(
            {
              minutes,
            },
            {
              one: `# 分 ${remainingSeconds} 秒`,
              other: `# 分 ${remainingSeconds} 秒`,
            },
          ),
        }),
      );
    }
    return translate(
      msg({
        message: plural(
          {
            minutes,
          },
          {
            one: "# 分",
            other: "# 分",
          },
        ),
      }),
    );
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) {
    return translate(
      msg({
        message: plural(
          {
            hours,
          },
          {
            one: `# 小时 ${remainingMinutes} 分`,
            other: `# 小时 ${remainingMinutes} 分`,
          },
        ),
      }),
    );
  }
  return translate(
    msg({
      message: plural(
        {
          hours,
        },
        {
          one: "# 小时",
          other: "# 小时",
        },
      ),
    }),
  );
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
