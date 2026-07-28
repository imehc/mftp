import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { VictoryConfetti } from "./VictoryConfetti";

export function GameResultBar({
  title,
  details,
  rematchWaiting = false,
  celebrate = false,
  onRematch,
  onExit,
}: {
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
        className="relative z-30 shrink-0 animate-in border-t border-border bg-background px-3 py-2 pointer-events-auto slide-in-from-bottom-2 duration-300"
        style={{ paddingBottom: "calc(var(--safe-bottom, 0px) + 0.5rem)" }}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <div className="min-w-0 text-center sm:text-left">
            <div className="text-sm font-semibold">{title}</div>
            {details ? (
              <div className="mt-0.5 text-xs text-muted-foreground">{details}</div>
            ) : null}
          </div>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <Button
              size="sm"
              className="flex-1 sm:min-w-28"
              disabled={rematchWaiting}
              onClick={onRematch}
            >
              <RefreshCw data-icon="inline-start" />
              {rematchWaiting ? <Trans>等待对方…</Trans> : <Trans>再来一局</Trans>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 sm:min-w-28"
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
