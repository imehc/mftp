import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";

import { seatName } from "./BilliardsScore";
import type { FoulFeedback } from "./foul-feedback";
import type { BilliardsMode } from "./types";

// lingui-set comment="台球犯规原因，用于犯规者之后，不含犯规前缀"
const foulReasons = {
  "wrong-ball-potted": msg`打进非目标球`,
  "touching-ball-moved": msg`推动贴球`,
  "snooker-behind-nomination": msg`用指定球做障碍`,
  "cue-potted": msg`母球落袋`,
  "no-contact": msg`未碰到任何球`,
  "wrong-first-contact": msg`未先碰到合法目标球`,
  "no-rail": msg`未进球且首碰后无球碰库`,
  "illegal-break": msg`开球无进球且不足四个目标球碰库`,
  "potted-eight-early": msg`提前打进黑八`,
};
// lingui-reset

export function FoulSummary({
  feedback,
  mode,
}: {
  feedback: FoulFeedback;
  mode: BilliardsMode;
}) {
  const { t } = useLingui();
  const { penalty, shooter, recipient } = feedback;
  const reason =
    feedback.reason === "illegal-break" && mode.discipline === "nine-ball"
      ? t`开球未达到三球要求`
      : t(foulReasons[feedback.reason]);
  const offender = shooter !== null ? seatName(mode, shooter) : null;
  const beneficiary = recipient !== null ? seatName(mode, recipient) : null;
  if (penalty > 0) {
    return beneficiary !== null && offender !== null ? (
      <Plural
        comment="斯诺克判罚；offender 是犯规者，beneficiary 是获分者，罚分加给获分者而非扣除犯规者分数"
        value={{ penalty }}
        one={`${offender}犯规：${reason}，${beneficiary}获得 # 分。`}
        other={`${offender}犯规：${reason}，${beneficiary}获得 # 分。`}
      />
    ) : (
      <Plural
        comment="旧斯诺克存档未记录犯规者时的中性罚分说明"
        value={{ penalty }}
        one={`犯规：${reason}，罚分 # 分。`}
        other={`犯规：${reason}，罚分 # 分。`}
      />
    );
  }
  return offender !== null ? (
    <Trans comment="台球上一杆犯规者，不是当前处理犯规的人">
      {offender}犯规：{reason}
    </Trans>
  ) : (
    <Trans comment="台球上一杆犯规，旧存档未记录犯规者">犯规：{reason}</Trans>
  );
}
