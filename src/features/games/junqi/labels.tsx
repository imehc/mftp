import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";

import type {
  JunqiHistoryPayload,
  JunqiVariant,
  PieceKind,
  ResultReason,
  Side,
} from "./types";

export const VARIANT_LABELS = {
  open: msg({ message: "双人明棋", comment: "军棋玩法，双方棋子身份公开" }),
  hidden: msg({
    message: "双人暗棋",
    comment: "军棋玩法，仅己方和规则已揭示的身份可见",
  }),
  flip: msg({
    message: "翻棋",
    comment: "军棋玩法，先随机盖放，再逐步翻开棋子；不是旋转棋盘",
  }),
};

export function VariantLabel({ variant }: { variant: JunqiVariant }) {
  const { t } = useLingui();
  return t(VARIANT_LABELS[variant]);
}

export const PIECE_LABELS = {
  commander: msg({ message: "司令", comment: "军棋最高等级棋子" }),
  general: msg({ message: "军长", comment: "军棋中仅次于司令的棋子" }),
  division: msg({ message: "师长", comment: "军棋棋子名称" }),
  brigade: msg({ message: "旅长", comment: "军棋棋子名称" }),
  regiment: msg({ message: "团长", comment: "军棋棋子名称" }),
  battalion: msg({ message: "营长", comment: "军棋棋子名称" }),
  company: msg({ message: "连长", comment: "军棋棋子名称" }),
  platoon: msg({ message: "排长", comment: "军棋棋子名称" }),
  engineer: msg({ message: "工兵", comment: "军棋中可排雷、沿铁路转弯的棋子" }),
  bomb: msg({ message: "炸弹", comment: "军棋特殊棋子" }),
  mine: msg({ message: "地雷", comment: "军棋中不能移动的防守棋子" }),
  flag: msg({
    message: "军旗",
    comment: "军棋中被夺取就判负的棋子，并非游戏名称",
  }),
} satisfies Record<PieceKind, ReturnType<typeof msg>>;

// 棋面空间有限；译文使用短称，辅助技术和规则仍使用完整名称。
export const PIECE_FACE_LABELS = {
  commander: msg({
    message: "司令",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  general: msg({
    message: "军长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  division: msg({
    message: "师长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  brigade: msg({
    message: "旅长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  regiment: msg({
    message: "团长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  battalion: msg({
    message: "营长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  company: msg({
    message: "连长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  platoon: msg({
    message: "排长",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  engineer: msg({
    message: "工兵",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  bomb: msg({
    message: "炸弹",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  mine: msg({
    message: "地雷",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
  flag: msg({
    message: "军旗",
    context: "棋面简称",
    comment: "军棋棋面刻字，拉丁字母译文尽量不超过五个字符；完整名称另有消息",
  }),
} satisfies Record<PieceKind, ReturnType<typeof msg>>;

export const REASON_LABELS = {
  flag: msg({ message: "军旗被夺", comment: "军棋对局结束原因" }),
  immobilized: msg({
    message: "无棋可走",
    comment: "军棋对局结束原因，轮到的一方没有合法走法",
  }),
  concede: msg({ message: "认输", comment: "棋类对局主动承认失败" }),
  repetition: msg({ message: "三次重复局面", comment: "军棋和棋原因" }),
  "no-capture": msg({
    message: "连续 100 手未吃子",
    comment: "军棋和棋原因，一手为一方的一次移动",
  }),
} satisfies Record<ResultReason, ReturnType<typeof msg>>;

export function SideLabel({ side }: { side: Side }) {
  return side === 0 ? <Trans>红方</Trans> : <Trans>黑方</Trans>;
}

export function ResultLabel({
  winner,
  localSide,
  online = false,
}: {
  winner: Side | null;
  localSide: Side | null;
  online?: boolean;
}) {
  if (winner === null) return <Trans>和棋</Trans>;
  return winner === localSide ? (
    <Trans>你获胜</Trans>
  ) : online ? (
    <Trans>对方获胜</Trans>
  ) : (
    <Trans>电脑获胜</Trans>
  );
}

export const historyMode = (record: JunqiHistoryPayload) => (
  <>
    <VariantLabel variant={record.variant} /> ·{" "}
    {record.mode === "online" ? (
      <Trans>局域网联机</Trans>
    ) : (
      <Trans>电脑对战</Trans>
    )}
  </>
);
export const historyResult = (record: JunqiHistoryPayload) => (
  <ResultLabel
    winner={record.winner}
    localSide={record.localSide}
    online={record.mode === "online"}
  />
);
