import { Trans } from "@lingui/react/macro";
import { Circle } from "lucide-react";

import type { SeatIndex } from "./types";

type BlackWhiteMode =
  { kind: "ai"; localSeat: SeatIndex } | { kind: "hotseat" | "online" };

interface BlackWhiteHistory {
  mode: "ai" | "hotseat" | "online";
  winnerSeat: SeatIndex | null;
  localSeat?: SeatIndex;
}

export function seatName(
  mode: BlackWhiteMode,
  seat: SeatIndex,
  online?: {
    peerName: string;
    localSeat: SeatIndex;
  },
) {
  if (mode.kind === "online" && online) {
    return (
      <span className="inline-flex items-center gap-1">
        <Circle
          className={
            seat === 0 ? "size-3 fill-current" : "fill-background size-3"
          }
        />
        {seat === online.localSeat ? (
          <Trans>你</Trans>
        ) : (
          online.peerName || <Trans>对方</Trans>
        )}
      </span>
    );
  }
  if (mode.kind === "ai") {
    return seat === mode.localSeat ? <Trans>你</Trans> : "AI";
  }
  return seat === 0 ? (
    <span className="inline-flex items-center gap-1">
      <Circle className="size-3 fill-current" />
      <Trans>黑棋</Trans>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Circle className="fill-background size-3" />
      <Trans>白棋</Trans>
    </span>
  );
}

export function matchResultLabel(
  mode: BlackWhiteMode,
  winnerSeat: SeatIndex | null,
  online?: {
    peerName: string;
    localSeat: SeatIndex;
  },
) {
  if (winnerSeat === null) return <Trans>平局</Trans>;
  const localSeat =
    mode.kind === "online"
      ? online?.localSeat
      : mode.kind === "ai"
        ? mode.localSeat
        : null;
  if (localSeat != null) {
    return winnerSeat === localSeat ? (
      <Trans>你赢了</Trans>
    ) : (
      <Trans>你输了</Trans>
    );
  }
  const seatNameValue = seatName(mode, winnerSeat, online);
  return (
    <Trans comment="对局结果；seatNameValue 是包含图标的黑棋或白棋名称。">
      {seatNameValue} 获胜
    </Trans>
  );
}

export function historyResult(payload: BlackWhiteHistory) {
  if (payload.winnerSeat === null) return <Trans>平局</Trans>;
  if (payload.mode === "ai") {
    return payload.winnerSeat === (payload.localSeat ?? 0) ? (
      <Trans comment="棋类历史记录：本地玩家获胜。">胜</Trans>
    ) : (
      <Trans comment="棋类历史记录：本地玩家落败。">负</Trans>
    );
  }
  if (payload.mode === "online" && payload.localSeat != null) {
    return payload.winnerSeat === payload.localSeat ? (
      <Trans comment="棋类历史记录：本地玩家获胜。">胜</Trans>
    ) : (
      <Trans comment="棋类历史记录：本地玩家落败。">负</Trans>
    );
  }
  return payload.winnerSeat === 0 ? (
    <Trans>黑棋胜</Trans>
  ) : (
    <Trans>白棋胜</Trans>
  );
}
