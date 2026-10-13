import { Trans } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";

import { seatName } from "./BilliardsScore";
import { availablePoints, needsPenaltyPoints, snookerSeat } from "./snooker";
import { snookerRuleActions } from "./snooker-rule-actions";
import type { BilliardsMode, BilliardsMove, SnookerState } from "./types";

export function SnookerScore({
  state,
  mode,
  activeSeat,
  target,
}: {
  state: SnookerState;
  mode: BilliardsMode;
  activeSeat: number | null;
  target: ReactNode;
}) {
  const currentBreak = state.currentBreak;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      {[0, 1].map((seat) => (
        <div
          key={seat}
          className={
            seat
              ? "col-start-3 row-start-1 flex min-w-0 items-center justify-end gap-2"
              : "flex min-w-0 items-center gap-2"
          }
        >
          <Badge
            className="max-w-full"
            variant={activeSeat === seat ? "secondary" : "outline"}
          >
            <span className="truncate">{seatName(mode, seat)}</span>
          </Badge>
          <span className="text-lg font-semibold tabular-nums">
            {state.scores[seat]}
          </span>
        </div>
      ))}
      <div className="billiards-target col-start-2 row-start-1 flex min-w-0 items-center justify-center gap-2">
        {target}
        <span className="text-muted-foreground whitespace-nowrap">
          <Trans comment="斯诺克当前连续得分">单杆 {currentBreak}</Trans>
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
  const decision = state.decision;
  const actions = snookerRuleActions(state);
  const player = seatName(mode, snookerSeat(state));
  const remaining = availablePoints(state);
  const penalty = state.lastScore?.penalty ?? 0;
  const choose = (
    choice: Extract<BilliardsMove, { type: "decision" }>["choice"],
  ) => onMove({ type: "decision", choice });
  return (
    <div className="flex flex-col gap-3 text-sm">
      {decision ? (
        <div className="flex flex-col gap-3">
          <p className="leading-relaxed">
            {player}
            {" · "}
            {decision.kind === "black-choice" ? (
              <Trans>同分黑球已复位。抽签获选者决定谁先打，母球在 D 区。</Trans>
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
          </p>
          {penalty > 0 ? (
            <p className="text-muted-foreground" role="status">
              <Trans comment="斯诺克犯规处理弹层，本杆判罚的分数">
                犯规罚分：{penalty} 分
              </Trans>
            </p>
          ) : null}
          <div className="flex flex-col">
            {decision.kind === "foul" && decision.warning ? (
              <SnookerRuleChoice
                disabled={!enabled}
                onClick={() => choose("acknowledge")}
                description={<Trans>已了解本次警告，继续处理球局。</Trans>}
              >
                <Trans comment="斯诺克漏击判负或六红球五次规则的赛前警告确认">
                  确认警告
                </Trans>
              </SnookerRuleChoice>
            ) : (
              <>
                <SnookerRuleChoice
                  disabled={!enabled}
                  onClick={() => choose("accept")}
                  description={<Trans>由你完成下一杆。</Trans>}
                >
                  <Trans comment="斯诺克犯规后或同分黑球抽签后选择自己击球">
                    自己接打
                  </Trans>
                </SnookerRuleChoice>
                <SnookerRuleChoice
                  disabled={!enabled}
                  onClick={() => choose("return")}
                  description={<Trans>由对方完成下一杆。</Trans>}
                >
                  <Trans comment="斯诺克要求另一位球员从桌面当前球位击球">
                    由对方击球
                  </Trans>
                </SnookerRuleChoice>
                {decision.kind === "foul" && decision.replace ? (
                  <SnookerRuleChoice
                    disabled={!enabled}
                    onClick={() => choose("replace")}
                    description={
                      <Trans comment="斯诺克漏击后恢复上一杆前球位，已判罚分不撤销">
                        恢复上一杆前的球位，由犯规方重打，罚分保留。
                      </Trans>
                    }
                  >
                    <Trans comment="斯诺克漏击后恢复球位，让犯规方再打，罚分保留">
                      原位重打
                    </Trans>
                  </SnookerRuleChoice>
                ) : null}
                {decision.kind === "foul" && decision.anywhere ? (
                  <SnookerRuleChoice
                    disabled={!enabled}
                    onClick={() => choose("anywhere")}
                    description={
                      <Trans comment="六红球特殊手中球，可在全台合法位置摆放母球">
                        在全台合法位置摆放母球，由你击球。
                      </Trans>
                    }
                  >
                    <Trans comment="六红球第五次漏击后的特殊母球放置权，不是自由球">
                      全台手中球
                    </Trans>
                  </SnookerRuleChoice>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <FieldGroup density="compact">
          {actions.reposition ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!enabled || state.ballInHand}
              onClick={() => onMove({ type: "reposition-cue" })}
            >
              <Trans>调整母球</Trans>
            </Button>
          ) : null}

          {actions.claim ? (
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
        </FieldGroup>
      )}
      {!decision && state.lastScore?.penalty ? (
        <span role="status">
          <Trans comment="斯诺克犯规罚分计入对手比分">
            对手获罚分 {penalty}
          </Trans>
        </span>
      ) : null}
      {needsPenaltyPoints(state) ? (
        <span className="text-inherit">
          <Trans>台面余分 {remaining}，落后方需要罚分追赶；对局继续。</Trans>
        </span>
      ) : null}
    </div>
  );
}

function SnookerRuleChoice({
  children,
  description,
  disabled,
  onClick,
}: {
  children: ReactNode;
  description: ReactNode;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      data-rule-choice
      disabled={disabled}
      onClick={onClick}
      className="hover:bg-accent focus-visible:ring-ring flex min-h-16 w-full items-center gap-3 border-b px-2 py-3 text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium">{children}</span>
        <span className="text-muted-foreground text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0"
      />
    </button>
  );
}
