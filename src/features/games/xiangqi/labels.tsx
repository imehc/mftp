import { Trans } from "@lingui/react/macro";
import { Circle } from "lucide-react";
import type { SeatIndex } from "../engine/types";
import type {
  XiangqiHistoryPayload,
  XiangqiMode,
  XiangqiResultReason,
} from "./types";

export function sideName(
  mode: XiangqiMode,
  side: SeatIndex,
  online?: { peerName: string; localSeat: SeatIndex },
) {
  if (mode.kind === "online" && online) {
    return (
      <span className={side === 0 ? "inline-flex items-center gap-1 text-[#b63a32]" : "inline-flex items-center gap-1"}>
        <Circle className="size-3 fill-current" />
        {side === online.localSeat ? <Trans>你</Trans> : online.peerName || <Trans>对方</Trans>}
      </span>
    );
  }
  if (mode.kind === "ai") {
    return side === mode.localSeat ? <Trans>你</Trans> : "AI";
  }
  return side === 0 ? (
    <span className="inline-flex items-center gap-1 text-[#b63a32]">
      <Circle className="size-3 fill-current" />
      <Trans>红方</Trans>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Circle className="size-3 fill-current" />
      <Trans>黑方</Trans>
    </span>
  );
}

export function resultReasonLabel(reason: XiangqiResultReason) {
  if (reason === "general-captured") return <Trans>将帅被吃</Trans>;
  if (reason === "checkmate") return <Trans>将死</Trans>;
  if (reason === "stalemate") return <Trans>困毙</Trans>;
  if (reason === "repetition") return <Trans>三次重复局面</Trans>;
  if (reason === "no-capture") return <Trans>连续六十回合未吃子</Trans>;
  return null;
}

export function matchResultLabel(
  mode: XiangqiMode,
  winnerSeat: SeatIndex | null,
  online?: { peerName: string; localSeat: SeatIndex },
) {
  if (winnerSeat === null) return <Trans>和棋</Trans>;
  const localSeat =
    mode.kind === "online"
      ? online?.localSeat
      : mode.kind === "ai"
        ? mode.localSeat
        : null;
  if (localSeat != null) {
    return winnerSeat === localSeat ? <Trans>你赢了</Trans> : <Trans>你输了</Trans>;
  }
  return (
    <span>
      {sideName(mode, winnerSeat, online)} <Trans>获胜</Trans>
    </span>
  );
}

export function historyModeLabel(payload: XiangqiHistoryPayload) {
  if (payload.mode === "hotseat") return <Trans>双人</Trans>;
  if (payload.mode === "online") return <Trans>联机</Trans>;
  return (
    <span>
      <Trans>人机</Trans>
      {" · "}
      {payload.difficulty === "easy" ? (
        <Trans>简单</Trans>
      ) : payload.difficulty === "hard" ? (
        <Trans>困难</Trans>
      ) : (
        <Trans>中等</Trans>
      )}
    </span>
  );
}

export function historyResult(payload: XiangqiHistoryPayload) {
  if (payload.winnerSeat === null) return <Trans>和</Trans>;
  if (payload.mode === "ai") {
    return payload.winnerSeat === (payload.localSeat ?? 0) ? (
      <Trans>胜</Trans>
    ) : (
      <Trans>负</Trans>
    );
  }
  if (payload.mode === "online" && payload.localSeat != null) {
    return payload.winnerSeat === payload.localSeat ? <Trans>胜</Trans> : <Trans>负</Trans>;
  }
  return payload.winnerSeat === 0 ? <Trans>红胜</Trans> : <Trans>黑胜</Trans>;
}

export function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
