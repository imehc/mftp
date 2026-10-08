import { useEffect } from "react";

/**
 * 联机（局域网）流程：大厅交接 + 共享对局控制器的网络对局视图接线。
 * 走法/座位时序校验、悔棋与重赛协商均由 OnlineMatchController 收口。
 */
import { useSettingsStore } from "~/store/settings";

import type { OnlineGame } from "../engine/online/matchTypes";
import { OnlineLobby } from "../engine/online/OnlineLobby";
import { OnlineMatchDialogs } from "../engine/online/OnlineMatchDialogs";
import { hashString, OnlineMatchSession } from "../engine/online/session";
import { useOnlineMatch } from "../engine/online/useOnlineMatch";
import { useOnlineRoom } from "../engine/online/useOnlineRoom";
import type { MoveResolution } from "../engine/types";
import { playFinishSound, playStoneSound } from "./audio";
import { GomokuMatchView } from "./GomokuMatch";
import { parseGomokuMove } from "./onlineProtocol";
import { createInitialGomokuState, gomokuGame } from "./rules";
import {
  GOMOKU_GAME_ID,
  type GomokuMode,
  type GomokuMove,
  type GomokuState,
} from "./types";

/** 分歧触发器，与对端的 RemoteMove.stateHash 比对。 */
function hashGomokuState(state: GomokuState): string {
  const cells = state.board
    .map((stone) => (stone === null ? "." : String(stone)))
    .join("");
  return hashString(`${cells}|${state.turnSeat}|${state.moveCount}`);
}

const GOMOKU_ONLINE: OnlineGame<GomokuState, GomokuMove, GomokuMove> = {
  game: gomokuGame,
  initialState: createInitialGomokuState,
  hash: hashGomokuState,
};

export function GomokuOnlineFlow({
  onPlayingChange,
  onExit,
  onFinishedChange,
}: {
  onPlayingChange: (playing: boolean) => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { owner, ready } = useOnlineRoom<GomokuMove>(GOMOKU_GAME_ID);
  useEffect(() => {
    onPlayingChange(ready !== null);
  }, [ready, onPlayingChange]);
  if (!ready) {
    return (
      <OnlineLobby<GomokuMove>
        gameId={GOMOKU_GAME_ID}
        parseMove={parseGomokuMove}
        owner={owner}
        onExit={onExit}
      />
    );
  }
  return (
    <OnlineMatch
      session={ready.session}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
    />
  );
}

function OnlineMatch({
  session,
  onExit,
  onFinishedChange,
}: {
  session: OnlineMatchSession<GomokuMove>;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((s) => s.gamesVolume);

  const present = (resolution: MoveResolution<GomokuState, GomokuMove>) => {
    playStoneSound(volume);
    if (resolution.state.finished) playFinishSound(volume);
  };

  const {
    controller,
    snapshot,
    undoFlow,
    endReason,
    rematchWaiting,
    rematchIncoming,
  } = useOnlineMatch(session, GOMOKU_ONLINE, present);
  const mode: GomokuMode = { kind: "online" };
  return (
    <>
      {/* 重赛由控制器换 round；视图按 round 重建以复位结果条与历史录制。 */}
      <GomokuMatchView
        key={snapshot.round}
        mode={mode}
        session={{ runner: snapshot.match.runner, local: snapshot.match.local }}
        online={{
          peerName: session.peerName,
          localSeat: snapshot.localSeat,
          undoWaiting: undoFlow?.kind === "waiting",
          rematchWaiting,
          onRequestUndo: controller.requestUndo,
        }}
        onRematch={controller.requestRematch}
        onExit={onExit}
        onFinishedChange={onFinishedChange}
      />
      <OnlineMatchDialogs
        undoFlow={undoFlow}
        onRespondUndo={controller.respondUndo}
        rematchIncoming={rematchIncoming}
        onRespondRematch={controller.respondRematch}
        endReason={endReason}
        onExit={onExit}
      />
    </>
  );
}
