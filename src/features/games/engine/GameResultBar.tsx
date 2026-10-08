import { Trans } from "@lingui/react/macro";
import { cn } from "cn";
import { ArrowLeft, RefreshCw, Trophy } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

import { VictoryConfetti } from "./VictoryConfetti";

export function GameResultBar({
  presentation = "bar",
  title,
  details,
  rematchWaiting = false,
  celebrate = false,
  onRematch,
  onExit,
}: {
  presentation?: "bar" | "page";
  title: ReactNode;
  details?: ReactNode;
  rematchWaiting?: boolean;
  celebrate?: boolean;
  onRematch: () => void;
  onExit: () => void;
}) {
  return (
    <>
      {celebrate ? <VictoryConfetti /> : null}
      <section
        aria-live="polite"
        className={cn(
          "border-border bg-background pointer-events-auto relative z-30 px-3 py-2",
          presentation === "page"
            ? "app-scroll-safe-end flex min-h-0 flex-1 overflow-auto"
            : "animate-in slide-in-from-bottom-2 shrink-0 border-t duration-300",
        )}
        style={{
          paddingBottom: "calc(var(--safe-bottom, 0px) + 0.5rem)",
        }}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-4xl flex-col items-center gap-3",
            presentation === "page"
              ? "my-auto py-8"
              : "gap-2 md:flex-row md:justify-between",
          )}
        >
          {presentation === "page" ? (
            <Trophy className="bg-muted size-12 rounded-xl p-3" />
          ) : null}
          <div
            className={cn(
              "min-w-0 text-center",
              presentation === "bar" && "md:text-left",
            )}
          >
            <div className="text-sm font-semibold">{title}</div>
            {details ? (
              <div className="text-muted-foreground mt-0.5 text-xs">
                {details}
              </div>
            ) : null}
          </div>
          <div
            className={cn(
              "flex w-full shrink-0 gap-2 md:w-auto",
              presentation === "page" && "max-w-sm",
            )}
          >
            <Button
              size="sm"
              className="flex-1 md:min-w-28"
              disabled={rematchWaiting}
              onClick={onRematch}
            >
              <RefreshCw data-icon="inline-start" />
              {rematchWaiting ? (
                <Trans>等待对方…</Trans>
              ) : (
                <Trans>再来一局</Trans>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 md:min-w-28"
              onClick={onExit}
            >
              <ArrowLeft data-icon="inline-start" />
              <Trans>返回选择</Trans>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
