import { cn } from "cn";
import type { ReactNode } from "react";

export interface GameToolbarPlayers {
  local: ReactNode;
  opponent: ReactNode;
  active?: "local" | "opponent";
  activity?: ReactNode;
  activitySide?: "local" | "opponent";
}

/** 对局的三列等宽两侧让计数始终位于状态栏的几何中心。 */
export function GameMatchDisplay({
  players,
  metrics,
  statusActions,
}: {
  players: GameToolbarPlayers;
  metrics?: ReactNode;
  statusActions?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 text-xs md:gap-2">
      <PlayerCell side="local" players={players} actions={statusActions} />
      <div className="text-muted-foreground flex shrink-0 items-center justify-center gap-2 whitespace-nowrap tabular-nums">
        {metrics}
      </div>
      <PlayerCell side="opponent" players={players} actions={statusActions} />
    </div>
  );
}

function PlayerCell({
  side,
  players,
  actions,
}: {
  side: "local" | "opponent";
  players: GameToolbarPlayers;
  actions?: ReactNode;
}) {
  const showActivity = players.activitySide === side;
  return (
    <div
      data-player-side={side}
      aria-current={players.active === side ? "true" : undefined}
      className={cn(
        "flex min-w-0 items-center gap-1 md:gap-2",
        side === "opponent" && "justify-end text-right",
      )}
    >
      <span
        className={cn(
          "shrink-0 truncate",
          side === "opponent" && "order-3",
          players.active === side
            ? "text-foreground font-medium"
            : "text-muted-foreground",
        )}
      >
        {players[side]}
      </span>
      {showActivity && players.activity ? (
        <span
          className={cn("min-w-0 truncate", side === "opponent" && "order-1")}
          role="status"
          aria-atomic="true"
        >
          {players.activity}
        </span>
      ) : null}
      {showActivity && actions ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            side === "opponent" && "order-2",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
