import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";

import type { Difficulty } from "./ai";
import type { SeatIndex } from "./types";

/** 棋盘按可用像素独立适配；文字与操作随根级 rem 缩放，不缩放整个 Canvas。 */
export function BoardMatchLayout({
  title,
  mode,
  localSeat,
  red = false,
  status,
  controls,
  finished,
  children,
}: {
  title: ReactNode;
  mode: { kind: string; difficulty?: Difficulty };
  localSeat: SeatIndex;
  red?: boolean;
  status: ReactNode;
  controls: ReactNode;
  finished: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-3 md:px-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {mode.kind === "hotseat" ? (
              <Trans>双人对战</Trans>
            ) : red ? (
              localSeat === 0 ? (
                <Trans>你执红</Trans>
              ) : (
                <Trans>你执黑</Trans>
              )
            ) : localSeat === 0 ? (
              <Trans>你执黑</Trans>
            ) : (
              <Trans>你执白</Trans>
            )}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">
            {mode.kind === "ai" ? (
              <>
                <Trans>人机</Trans> ·{" "}
                {mode.difficulty === "easy" ? (
                  <Trans>简单</Trans>
                ) : mode.difficulty === "hard" ? (
                  <Trans>困难</Trans>
                ) : (
                  <Trans>中等</Trans>
                )}
              </>
            ) : mode.kind === "online" ? (
              <Trans>局域网联机</Trans>
            ) : (
              <Trans>同屏轮流</Trans>
            )}
          </div>
        </div>
        <div
          role="status"
          className="flex max-w-[65%] min-w-0 flex-wrap justify-end gap-1.5 text-xs [&_[data-slot=badge]]:whitespace-normal"
        >
          <Badge variant="secondary">{title}</Badge>
          {status}
        </div>
      </div>
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden px-3 py-1.5 md:px-4">
        {children}
      </div>
      {!finished ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-2 md:px-4"
          style={{ paddingBottom: "calc(var(--safe-bottom, 0px) + 0.5rem)" }}
        >
          <span className="text-muted-foreground text-xs">{title}</span>
          <div className="flex flex-wrap items-center gap-2">{controls}</div>
        </div>
      ) : null}
    </>
  );
}
