import { Plural, Trans } from "@lingui/react/macro";

import { seatName } from "./BilliardsScore";
import type { FoulFeedback } from "./foul-feedback";
import type { BilliardsMode, FoulReason } from "./types";

export function FoulSummary({
  feedback,
  mode,
}: {
  feedback: FoulFeedback;
  mode: BilliardsMode;
}) {
  const { penalty, shooter, recipient } = feedback;
  const offender = shooter !== null ? seatName(mode, shooter) : null;
  const beneficiary = recipient !== null ? seatName(mode, recipient) : null;
  if (penalty > 0) {
    return beneficiary !== null && offender !== null ? (
      <Plural
        comment="斯诺克判罚；offender 是犯规者，beneficiary 是获分者，罚分加给获分者而非扣除犯规者分数"
        value={{ penalty }}
        one={`${offender} 犯规，${beneficiary} 获得 # 分。`}
        other={`${offender} 犯规，${beneficiary} 获得 # 分。`}
      />
    ) : (
      <Plural
        comment="旧斯诺克存档未记录犯规者时的中性罚分说明"
        value={{ penalty }}
        one="本杆犯规罚分：# 分"
        other="本杆犯规罚分：# 分"
      />
    );
  }
  return offender !== null ? (
    <Trans comment="台球上一杆犯规者，不是当前处理犯规的人">
      {offender} 犯规。
    </Trans>
  ) : (
    <Trans comment="台球上一杆犯规，旧存档未记录犯规者">犯规</Trans>
  );
}

export function foulLabel(foul: FoulReason) {
  switch (foul) {
    case "wrong-ball-potted":
      return <Trans>犯规：打进非目标球</Trans>;
    case "touching-ball-moved":
      return <Trans>犯规：推动贴球</Trans>;
    case "snooker-behind-nomination":
      return <Trans>犯规：用指定球做障碍</Trans>;
    case "cue-potted":
      return <Trans>犯规：母球落袋</Trans>;
    case "no-contact":
      return <Trans>犯规：未碰到任何球</Trans>;
    case "wrong-first-contact":
      return <Trans>犯规：未先碰到合法目标球</Trans>;
    case "no-rail":
      return <Trans>犯规：未进球且首碰后无球碰库</Trans>;
    case "illegal-break":
      return <Trans>犯规：开球无进球且不足四个目标球碰库</Trans>;
    case "potted-eight-early":
      return <Trans>犯规：提前打进黑八</Trans>;
  }
}
