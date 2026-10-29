import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { InfoIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Separator } from "~/components/ui/separator";

import { BallTray, seatName, seatTray } from "./BilliardsScore";
import { BilliardsShotHelp } from "./BilliardsShotHelp";
import { availablePoints } from "./snooker";
import { isRed } from "./snooker-equipment";
import type { BilliardsMode, BilliardsState } from "./types";

export function BilliardsDetails({
  state,
  mode,
  open,
  onOpenChange,
}: {
  state: BilliardsState;
  mode: BilliardsMode;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useLingui();
  const shotCount = state.shotCount;
  const redCount = state.balls.filter(
    (ball) => !ball.potted && isRed(ball.id),
  ).length;
  const remainingBallCount = state.balls.filter(
    (ball) => ball.id && !ball.potted,
  ).length;
  const remainingPoints =
    state.variant === "snooker" ? availablePoints(state) : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          density="adaptive"
          aria-label={t`对局详情`}
          title={t`对局详情`}
        >
          <InfoIcon />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent placement="center" aria-describedby={undefined}>
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>对局详情</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <div className="flex flex-col gap-3 text-sm">
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <Plural value={{ shotCount }} one="总杆数 #" other="总杆数 #" />
              {state.variant === "snooker" ? (
                <>
                  <span className="whitespace-nowrap">
                    <Plural
                      value={{ redCount }}
                      one="剩余 # 颗红球"
                      other="剩余 # 颗红球"
                    />
                  </span>
                  <span className="whitespace-nowrap">
                    <Trans comment="斯诺克桌面所有剩余目标球的可得分值">
                      台面余分 {remainingPoints}
                    </Trans>
                  </span>
                </>
              ) : (
                <span className="whitespace-nowrap">
                  <Plural
                    value={{ remainingBallCount }}
                    one="剩余 # 球"
                    other="剩余 # 球"
                  />
                </span>
              )}
            </div>
            {mode.kind !== "practice" ? <Separator /> : null}
            {mode.kind !== "practice"
              ? [0, 1].map((seat) => {
                  const tray = seatTray(state, seat);
                  const foulCount = state.foulCounts[seat] ?? 0;
                  const consecutiveFouls =
                    state.variant === "nine-ball"
                      ? state.consecutiveFouls[seat]
                      : 0;
                  const score =
                    state.variant === "snooker" ? state.scores[seat] : 0;
                  const highestBreak =
                    state.variant === "snooker" ? state.highestBreaks[seat] : 0;
                  return (
                    <section
                      key={seat}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2"
                    >
                      <h3>
                        <Badge variant="secondary">
                          {seatName(mode, seat)}
                        </Badge>
                      </h3>
                      {state.variant === "snooker" ? (
                        <>
                          <span className="font-semibold whitespace-nowrap tabular-nums">
                            <Trans comment="斯诺克对局详情，球员当前得分">
                              得分 {score}
                            </Trans>
                          </span>
                          <span className="text-muted-foreground text-xs whitespace-nowrap">
                            <Trans comment="斯诺克对局详情，球员本局最高连续得分">
                              最高单杆 {highestBreak}
                            </Trans>
                          </span>
                        </>
                      ) : null}
                      {tray ? <BallTray state={state} ids={tray} /> : null}
                      <p className="text-muted-foreground text-xs whitespace-nowrap">
                        <Plural
                          value={{ foulCount }}
                          one="犯规 # 次"
                          other="犯规 # 次"
                        />
                      </p>
                      {state.variant === "nine-ball" ? (
                        <p className="text-muted-foreground text-xs whitespace-nowrap">
                          <Plural
                            value={{ consecutiveFouls }}
                            one="连续犯规 # 次"
                            other="连续犯规 # 次"
                          />
                        </p>
                      ) : null}
                    </section>
                  );
                })
              : null}
            <Separator />
            <BilliardsShotHelp />
          </div>
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
