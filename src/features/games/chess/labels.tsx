import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import type { ChessHistoryPayload, ChessMode, ChessResult } from "./types";

export const pieceNames = {
  k: msg({
    message: "王",
    context: "国际象棋棋子",
    comment: "国际象棋 King 棋子",
  }),
  q: msg({
    message: "后",
    context: "国际象棋棋子",
    comment: "国际象棋 Queen 棋子",
  }),
  r: msg({
    message: "车",
    context: "国际象棋棋子",
    comment: "国际象棋 Rook 棋子",
  }),
  b: msg({
    message: "象",
    context: "国际象棋棋子",
    comment: "国际象棋 Bishop 棋子",
  }),
  n: msg({
    message: "马",
    context: "国际象棋棋子",
    comment: "国际象棋 Knight 棋子",
  }),
  p: msg({
    message: "兵",
    context: "国际象棋棋子",
    comment: "国际象棋 Pawn 棋子",
  }),
};
export const resultNames = {
  checkmate: msg({ message: "将死", comment: "国际象棋被将军且没有合法应对" }),
  stalemate: msg({
    message: "逼和",
    comment: "国际象棋无合法着法但未被将军，判和棋",
  }),
  material: msg({
    message: "子力不足",
    comment: "国际象棋剩余子力无法形成将死",
  }),
  fivefold: msg`五次重复局面`,
  "seventy-five": msg`七十五步规则`,
  threefold: msg`三次重复局面`,
  fifty: msg`五十步规则`,
} satisfies Record<ChessResult, ReturnType<typeof msg>>;

export function sideName(seat: number) {
  return seat === 0 ? <Trans>白方</Trans> : <Trans>黑方</Trans>;
}

export function chessResultLabel(
  mode: ChessMode,
  winner: number | null,
  localSeat: number,
) {
  if (winner === null) return <Trans>和棋</Trans>;
  if (mode.kind !== "hotseat")
    return winner === localSeat ? <Trans>你赢了</Trans> : <Trans>你输了</Trans>;
  return winner === 0 ? <Trans>白棋胜</Trans> : <Trans>黑棋胜</Trans>;
}

export function chessHistoryResult(payload: ChessHistoryPayload) {
  if (payload.winnerSeat === null) return <Trans>和棋</Trans>;
  if (payload.mode === "hotseat") return sideName(payload.winnerSeat);
  return payload.winnerSeat === payload.localSeat ? (
    <Trans comment="棋类历史记录胜负">胜</Trans>
  ) : (
    <Trans comment="棋类历史记录胜负">负</Trans>
  );
}
