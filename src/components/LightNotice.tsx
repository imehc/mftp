import { cn } from "cn";
import { type ReactNode, useEffect, useState } from "react";

export interface LightNoticeMessage {
  id: string;
  message: ReactNode;
  tone?: "error";
}

/** 局部轻提示：父容器提供定位，不占布局、不拦截点击，每次新消息独立计时。 */
export function LightNotice({
  notice,
  duration = 3000,
  className,
  inline = false,
}: {
  notice: LightNoticeMessage | null;
  duration?: number;
  className?: string;
  inline?: boolean;
}) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const id = notice?.id;
  const visible = Boolean(notice && dismissedId !== id);
  useEffect(() => {
    if (!id) return;
    const timer = window.setTimeout(() => setDismissedId(id), duration);
    const hide = window.setTimeout(() => setHiddenId(id), duration + 150);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hide);
    };
  }, [id, duration]);
  if (!notice || hiddenId === id) return null;
  return (
    <div
      data-slot="light-notice"
      role={notice.tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      className={cn(
        "pointer-events-none flex max-w-full min-w-0 justify-center",
        inline ? "relative" : "absolute inset-x-3 top-3 z-10",
        className,
      )}
    >
      <span
        aria-hidden={!visible}
        className={cn(
          "bg-popover max-w-full rounded-md px-3 py-1.5 text-center text-xs leading-relaxed wrap-anywhere shadow-sm transition-opacity duration-150 motion-reduce:transition-none",
          notice.tone === "error"
            ? "text-destructive"
            : "text-popover-foreground",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        {notice?.message}
      </span>
    </div>
  );
}

/** 同时出现的短提示共用一个定位层，最多两条，不互相覆盖。 */
export function LightNoticeStack({
  notices,
}: {
  notices: (LightNoticeMessage | null | undefined)[];
}) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-center gap-2">
      {notices
        .filter((notice): notice is LightNoticeMessage => Boolean(notice))
        .slice(-2)
        .map((notice) => (
          <LightNotice key={notice.id} notice={notice} inline />
        ))}
    </div>
  );
}
