/** Seat / result / history label helpers shared by the gomoku screens. */
import { Trans } from "@lingui/react/macro";
import { Circle } from "lucide-react";
import type { SeatIndex } from "../engine/types";
import type { GomokuHistoryPayload, GomokuMode } from "./types";

export function seatName(
  mode: GomokuMode,
  seat: SeatIndex,
  online?: { peerName: string; localSeat: SeatIndex },
) {
  if (mode.kind === "online" && online) {
    return (
      <span className="inline-flex items-center gap-1">
        <Circle
          className={
            seat === 0 ? "size-3 fill-current" : "size-3 fill-background"
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
      <Circle className="size-3 fill-background" />
      <Trans>白棋</Trans>
    </span>
  );
}

/**
 * Result line from the local player's perspective where one exists
 * (vs-AI and online); hotseat keeps the neutral black-wins/white-wins form.
 */
export function matchResultLabel(
  mode: GomokuMode,
  winnerSeat: SeatIndex | null,
  online?: { peerName: string; localSeat: SeatIndex },
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
  return <Trans>{seatName(mode, winnerSeat, online)} 获胜</Trans>;
}

export function historyModeLabel(payload: GomokuHistoryPayload) {
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

export function historyResult(payload: GomokuHistoryPayload) {
  if (payload.winnerSeat === null) return <Trans>平局</Trans>;
  if (payload.mode === "ai") {
    return payload.winnerSeat === (payload.localSeat ?? 0) ? (
      <Trans>胜</Trans>
    ) : (
      <Trans>负</Trans>
    );
  }
  if (payload.mode === "online" && payload.localSeat != null) {
    return payload.winnerSeat === payload.localSeat ? (
      <Trans>胜</Trans>
    ) : (
      <Trans>负</Trans>
    );
  }
  return payload.winnerSeat === 0 ? <Trans>黑棋胜</Trans> : <Trans>白棋胜</Trans>;
}

export function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
