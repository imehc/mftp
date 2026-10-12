import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { seatName } from "./BilliardsScore";
import { availablePoints, needsPenaltyPoints, snookerSeat } from "./snooker";
import { COLOR_IDS, isRed } from "./snooker-equipment";
import { ballsOn } from "./snooker-visibility";
import { SnookerBall } from "./SnookerBall";
import type { BilliardsMode, BilliardsMove, SnookerState } from "./types";

export function SnookerScore({
  state,
  mode,
  activeSeat,
}: {
  state: SnookerState;
  mode: BilliardsMode;
  activeSeat: number | null;
}) {
  const redCount = state.balls.filter(
    (ball) => !ball.potted && isRed(ball.id),
  ).length;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      {[0, 1].map((seat) => (
        <div
          key={seat}
          className={
            seat
              ? "col-start-3 row-start-1 flex min-w-0 flex-col items-end gap-1"
              : "flex min-w-0 flex-col items-start gap-1"
          }
        >
          <Badge variant={activeSeat === seat ? "secondary" : "outline"}>
            {seatName(mode, seat)}
          </Badge>
          <span className="text-lg font-semibold tabular-nums">
            {state.scores[seat]}
          </span>
          <span className="text-muted-foreground">
            <Trans comment="斯诺克某位球员本局最高单杆分数">
              最高单杆 {state.highestBreaks[seat]}
            </Trans>
          </span>
        </div>
      ))}
      <div className="col-start-2 row-start-1 flex flex-col items-center gap-1 text-center">
        <span>
          <Trans comment="斯诺克当前连续得分">单杆 {state.currentBreak}</Trans>
        </span>
        {state.on.kind === "red" ? (
          <SnookerBall id={8} />
        ) : state.on.kind === "clearance" ? (
          <SnookerBall id={state.on.color} />
        ) : state.on.nominated === null ? (
          <Trans>请选择彩球</Trans>
        ) : (
          <SnookerBall id={state.on.nominated} />
        )}
        <span className="text-muted-foreground">
          <Plural value={redCount} one="剩余 # 颗红球" other="剩余 # 颗红球" />
        </span>
      </div>
    </div>
  );
}

export function SnookerActions({
  state,
  mode,
  enabled,
  onMove,
}: {
  state: SnookerState;
  mode: BilliardsMode;
  enabled: boolean;
  onMove(move: BilliardsMove): void;
}) {
  const { t } = useLingui();
  const [concede, setConcede] = useState(false);
  const decision = state.decision;
  const player = seatName(mode, snookerSeat(state));
  const on = ballsOn(state.balls, state.on);
  const freeChoices = state.balls.filter(
    (ball) => ball.id && !ball.potted && !on.includes(ball.id),
  );
  const remaining = availablePoints(state);
  const choose = (
    choice: Extract<BilliardsMove, { type: "decision" }>["choice"],
  ) => onMove({ type: "decision", choice });
  return (
    <div className="flex flex-col gap-2 px-3 py-2 text-xs">
      {decision ? (
        <Alert>
          <AlertDescription>
            <span>
              {player}
              {" · "}
              {decision.kind === "black-choice" ? (
                <Trans>
                  同分黑球已复位。抽签获选者决定谁先打，母球在 D 区。
                </Trans>
              ) : decision.warning === "three-miss" ? (
                <Trans>可整球直击却连续两次漏击，再次原位漏击将判负。</Trans>
              ) : decision.warning === "six-red" ? (
                <Trans>
                  已原位连续漏击四次。第五次后对手可能获得全台手中球。
                </Trans>
              ) : state.lastScore?.miss ? (
                <Trans>
                  犯规并漏击。可接打、要求对方留下位置重打，或在允许时恢复原位。
                </Trans>
              ) : (
                <Trans>犯规。可自己接打，或要求对方从留下位置重打。</Trans>
              )}
            </span>
            <div className="flex flex-wrap gap-2">
              {decision.kind === "foul" && decision.warning ? (
                <Button
                  size="sm"
                  disabled={!enabled}
                  onClick={() => choose("acknowledge")}
                >
                  <Trans comment="斯诺克漏击判负或六红球五次规则的赛前警告确认">
                    确认警告
                  </Trans>
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={!enabled}
                    onClick={() => choose("accept")}
                  >
                    <Trans comment="斯诺克犯规后或同分黑球抽签后选择自己击球">
                      自己接打
                    </Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!enabled}
                    onClick={() => choose("return")}
                  >
                    <Trans comment="斯诺克要求另一位球员从桌面当前球位击球">
                      由对方击球
                    </Trans>
                  </Button>
                  {decision.kind === "foul" && decision.replace ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!enabled}
                      onClick={() => choose("replace")}
                    >
                      <Trans comment="斯诺克漏击后恢复球位，让犯规方再打，罚分保留">
                        原位重打
                      </Trans>
                    </Button>
                  ) : null}
                  {decision.kind === "foul" && decision.anywhere ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!enabled}
                      onClick={() => choose("anywhere")}
                    >
                      <Trans comment="六红球第五次漏击后的特殊母球放置权，不是自由球">
                        全台手中球
                      </Trans>
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state.on.kind === "color" ? (
            <Field orientation="horizontal" className="w-auto max-w-full">
              <FieldLabel htmlFor="snooker-colour">
                <Trans comment="斯诺克进红后，出杆前指定本杆彩球">选彩</Trans>
              </FieldLabel>
              <Select
                disabled={!enabled}
                value={state.on.nominated?.toString() ?? ""}
                onValueChange={(value) =>
                  onMove({ type: "nominate", ballId: Number(value) })
                }
              >
                <SelectTrigger id="snooker-colour" wrapValue>
                  <SelectValue placeholder={t`请选择彩球`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {COLOR_IDS.map((id) => (
                      <SelectItem key={id} value={String(id)}>
                        <SnookerBall id={id} />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {state.freeBall ? (
            <Field orientation="horizontal" className="w-auto max-w-full">
              <FieldLabel htmlFor="snooker-free">
                <Trans comment="斯诺克犯规后被做障碍，可提名另一球代替ball-on，与母球手中球不同">
                  自由球
                </Trans>
              </FieldLabel>
              <Select
                disabled={!enabled}
                value={state.nominatedFree?.toString() ?? "none"}
                onValueChange={(value) =>
                  onMove({
                    type: "nominate-free",
                    ballId: value === "none" ? null : Number(value),
                  })
                }
              >
                <SelectTrigger id="snooker-free" wrapValue>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">
                      <Trans comment="斯诺克放弃自由球提名，直接打原目标">
                        不使用
                      </Trans>
                    </SelectItem>
                    {freeChoices.map((ball) => (
                      <SelectItem key={ball.id} value={String(ball.id)}>
                        <SnookerBall id={ball.id} />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {state.placementRegion ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!enabled || state.ballInHand}
              onClick={() => onMove({ type: "reposition-cue" })}
            >
              <Trans>调整母球</Trans>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={!enabled}
            onClick={() => setConcede(true)}
          >
            <Trans comment="斯诺克主动认输本局">认输</Trans>
          </Button>
          {state.on.kind === "clearance" &&
          state.on.color === 7 &&
          Math.abs(state.scores[0] - state.scores[1]) > 7 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!enabled}
              onClick={() => onMove({ type: "claim-frame" })}
            >
              <Trans comment="仅剩黑球且分差超过7分，按当前比分结束">
                结束本局
              </Trans>
            </Button>
          ) : null}
        </div>
      )}
      {state.lastScore?.penalty ? (
        <span role="status">
          <Trans comment="斯诺克犯规罚分计入对手比分">
            对手获罚分 {state.lastScore.penalty}
          </Trans>
        </span>
      ) : null}
      {needsPenaltyPoints(state) ? (
        <span className="text-muted-foreground">
          <Trans>台面余分 {remaining}，落后方需要罚分追赶；对局继续。</Trans>
        </span>
      ) : null}
      <AlertDialog open={concede} onOpenChange={setConcede}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>认输本局？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>本局将结束，对手获胜并保存当前比分。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!enabled}
              onClick={() => onMove({ type: "concede" })}
            >
              <Trans>认输</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
