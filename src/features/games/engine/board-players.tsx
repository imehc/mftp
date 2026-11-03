import type { ReactNode } from "react";

import type { GameToolbarPlayers } from "./GameMatchDisplay";
import { type GamePlayerColor, GamePlayerLabel } from "./GamePlayerLabel";
import type { SeatIndex } from "./types";

/** 座位到左右身份的映射只依赖本方座位，翻转视角不交换双方。 */
export function boardPlayers({
  kind,
  localSeat,
  activeSeat,
  firstColor = "black",
  activity,
  stats,
}: {
  kind: "ai" | "online" | "hotseat";
  localSeat: SeatIndex;
  activeSeat?: SeatIndex | null;
  firstColor?: GamePlayerColor;
  activity?: ReactNode;
  stats?: { local?: ReactNode; opponent?: ReactNode };
}): GameToolbarPlayers {
  const secondColor = firstColor === "black" ? "white" : "black";
  const localColor = localSeat === 0 ? firstColor : secondColor;
  const opponentColor = localSeat === 0 ? secondColor : firstColor;
  const active =
    activeSeat == null
      ? undefined
      : activeSeat === localSeat
        ? "local"
        : "opponent";
  return {
    local: (
      <>
        <GamePlayerLabel
          identity={kind === "hotseat" ? "player1" : "you"}
          color={localColor}
        />
        {stats?.local !== undefined ? <> · {stats.local}</> : null}
      </>
    ),
    opponent: (
      <>
        {stats?.opponent !== undefined ? <>{stats.opponent} · </> : null}
        <GamePlayerLabel
          identity={
            kind === "hotseat"
              ? "player2"
              : kind === "ai"
                ? "computer"
                : "opponent"
          }
          color={opponentColor}
        />
      </>
    ),
    active,
    activity,
    activitySide: active ?? "opponent",
  };
}
