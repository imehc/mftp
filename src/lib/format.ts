import { msg, plural } from "@lingui/core/macro";

import { translate } from "~/i18n/translate";

/** 传输/局域网活动共用的剩余时间格式；无效值统一用两个短横线。 */
export function formatDuration(seconds: number): string {
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
  // 超过 100 后去掉小数位，保持列宽稳定：1.5 GB、17.2 GB、999 GB。
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
