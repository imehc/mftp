import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";

import { Badge } from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import { ballDefinition } from "./ball-definitions";
import type { EquipmentId } from "./equipment";
import { equipmentForState } from "./placement";
import { useSnookerBallName } from "./SnookerBall";
import type { BilliardsMode, BilliardsState } from "./types";

export function seatName(mode: BilliardsMode, seat: number) {
  if (mode.kind === "ai")
    return seat === 0 ? <Trans>你</Trans> : <Trans>电脑</Trans>;
  return seat === 0 ? <Trans>玩家 1</Trans> : <Trans>玩家 2</Trans>;
}

export function BallIcon({
  id,
  potted,
  equipment = "chinese-eight",
}: {
  id: number;
  potted: boolean;
  equipment?: EquipmentId;
}) {
  const { t } = useLingui();
  const name = useSnookerBallName();
  const label =
    equipment === "snooker"
      ? name(id)
      : potted
        ? t`${id} 号球，已进球`
        : t`${id} 号球，未进球`;
  const { striped, color, number } = ballDefinition(id, equipment);
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "relative inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/25 dark:ring-white/30",
        potted && "opacity-25 saturate-0",
      )}
      style={{
        backgroundColor: striped ? "#f6f1e7" : color,
      }}
    >
      {striped ? (
        <span
          className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2"
          style={{
            backgroundColor: color,
          }}
        />
      ) : null}
      {number !== null ? (
        <span className="relative inline-flex size-2.5 items-center justify-center rounded-full bg-[#f6f1e7] text-[0.4375rem] leading-none font-bold text-neutral-900">
          {number}
        </span>
      ) : null}
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
        (equipmentForState(state).id !== "chinese-eight" ||
          ids.length > 8 ||
          id !== 8) &&
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
          equipment={equipmentForState(state).id}
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
  if (state.variant === "nine-ball" || state.variant === "snooker") return null;
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
  thinking = false,
}: {
  mode: BilliardsMode;
  state: BilliardsState;
  seat: number;
  active: boolean;
  align: "start" | "end";
  /** 该座位是 AI 且正在思考时，在徽章处显示旋转指示。 */
  thinking?: boolean;
}) {
  const { t } = useLingui();
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
      <Badge className="max-w-full" variant={active ? "secondary" : "outline"}>
        <span className="truncate">{seatName(mode, seat)}</span>
        {thinking ? <Spinner aria-label={t`电脑思考中…`} /> : null}
      </Badge>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-muted-foreground text-xs">
          {state.variant === "nine-ball" ? (
            <Plural
              value={{ consecutiveFouls: state.consecutiveFouls[seat] }}
              one="连续犯规 # 次"
              other="连续犯规 # 次"
            />
          ) : state.variant === "snooker" ? (
            state.scores[seat]
          ) : state.groups[seat] === "solids" ? (
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
