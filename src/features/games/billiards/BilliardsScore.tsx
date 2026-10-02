import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "~/components/ui/badge";
import { cn } from "cn";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { BALL_HEX } from "./colors";
import type { BilliardsMode, BilliardsState } from "./types";
export function seatName(mode: BilliardsMode, seat: number) {
  if (mode.kind === "ai") return seat === 0 ? <Trans>你</Trans> : "AI";
  return seat === 0 ? <Trans>玩家 1</Trans> : <Trans>玩家 2</Trans>;
}
function BallIcon({ id, potted }: { id: number; potted: boolean }) {
  const { t } = useLingui();
  const label = potted ? t`${id} 号球，已进球` : t`${id} 号球，未进球`;
  const striped = id >= 9 && id <= 15;
  const color = BALL_HEX[id];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full",
        potted && "opacity-25 saturate-0",
      )}
      style={{
        backgroundColor: striped ? "#f6f1e7" : color,
      }}
    >
      {striped ? (
        <span
          className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2"
          style={{
            backgroundColor: color,
          }}
        />
      ) : null}
      <span className="relative inline-flex size-2.5 items-center justify-center rounded-full bg-[#f6f1e7] text-[0.4375rem] leading-none font-bold text-neutral-900">
        {id}
      </span>
    </span>
  );
}

/** 剩余目标球条：已落袋的球仍显示但变暗。 */
export function BallTray({
  state,
  ids,
}: {
  state: BilliardsState;
  ids: readonly number[];
}) {
  const desktop = useDesktopLayout();
  if (!desktop) {
    const count = ids.filter(
      (id) =>
        (ids.length > 8 || id !== 8) &&
        !state.balls.find((ball) => ball.id === id)?.potted,
    ).length;
    return (
      <span className="text-muted-foreground text-xs">
        <Plural value={count} one="剩余 # 球" other="剩余 # 球" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      {ids.map((id) => (
        <BallIcon
          key={id}
          id={id}
          potted={state.balls.find((ball) => ball.id === id)?.potted ?? false}
        />
      ))}
    </span>
  );
}
const SOLID_TRAY = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const STRIPE_TRAY = [9, 10, 11, 12, 13, 14, 15, 8] as const;
export const ALL_TRAY = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;
export function seatTray(
  state: BilliardsState,
  seat: number,
): readonly number[] | null {
  const group = state.groups[seat];
  if (group === "solids") return SOLID_TRAY;
  if (group === "stripes") return STRIPE_TRAY;
  return null;
}

/** 对战 HUD 的一侧：玩家徽章 + 剩余球托盘。 */
export function SeatCell({
  mode,
  state,
  seat,
  active,
  align,
}: {
  mode: BilliardsMode;
  state: BilliardsState;
  seat: number;
  active: boolean;
  align: "start" | "end";
}) {
  const tray = seatTray(state, seat);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        align === "end"
          ? "items-end justify-self-end"
          : "items-start justify-self-start",
      )}
    >
      <Badge variant={active ? "secondary" : "outline"}>
        {seatName(mode, seat)}
      </Badge>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-xs">
          {state.groups[seat] === "solids" ? (
            <Trans>全色球</Trans>
          ) : state.groups[seat] === "stripes" ? (
            <Trans>花色球</Trans>
          ) : (
            <Trans>未分组</Trans>
          )}
        </span>
        {tray ? <BallTray state={state} ids={tray} /> : null}
      </div>
    </div>
  );
}
