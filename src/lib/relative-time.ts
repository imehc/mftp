import { msg, plural } from "@lingui/core/macro";
import { translate } from "~/i18n/translate";

interface RelativeTimeOptions {
  justNowThresholdMs?: number;
}

export function formatRelativeTime(
  timestamp: number,
  { justNowThresholdMs = 0 }: RelativeTimeOptions = {},
) {
  if (!timestamp) return "-";

  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < justNowThresholdMs) return translate(msg`刚刚`);

  if (diff < 60_000) {
    const seconds = Math.max(1, Math.floor(diff / 1000));
    return translate(
      msg({
        comment: "Relative time showing how many seconds ago an event occurred",
        message: plural({ seconds }, { one: "# 秒前", other: "# 秒前" }),
      }),
    );
  }

  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return translate(
      msg({
        comment: "Relative time showing how many minutes ago an event occurred",
        message: plural({ minutes }, { one: "# 分钟前", other: "# 分钟前" }),
      }),
    );
  }

  const hours = Math.floor(diff / 3_600_000);
  return translate(
    msg({
      comment: "Relative time showing how many hours ago an event occurred",
      message: plural({ hours }, { one: "# 小时前", other: "# 小时前" }),
    }),
  );
}
