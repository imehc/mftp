import { useEffect } from "react";

/**
 * 局域网中国象棋流程：大厅交接 + 共享对局控制器的网络对局视图接线。
 * 走法时序与悔棋/重赛协商由 OnlineMatchController 收口。
 */
import { useSettingsStore } from "~/store/settings";

import type { OnlineGame } from "../engine/online/matchTypes";
import { OnlineLobby } from "../engine/online/OnlineLobby";
import { OnlineMatchDialogs } from "../engine/online/OnlineMatchDialogs";
import { hashString, OnlineMatchSession } from "../engine/online/session";
import { useOnlineMatch } from "../engine/online/useOnlineMatch";
import { useOnlineRoom } from "../engine/online/useOnlineRoom";
import type { MoveResolution } from "../engine/types";
import { playCheckSound, playFinishSound, playMoveSound } from "./audio";
import { parseXiangqiMove } from "./onlineProtocol";
import { createInitialXiangqiState, xiangqiGame } from "./rules";
import {
  XIANGQI_GAME_ID,
  type XiangqiMode,
  type XiangqiMove,
  type XiangqiPresentation,
  type XiangqiState,
} from "./types";
import { XiangqiMatchView } from "./XiangqiMatch";

/** 分歧触发器，与对端的 RemoteMove.stateHash 比对。 */
function hashXiangqiState(state: XiangqiState): string {
  const board = state.board
    .map((piece) => (piece ? `${piece.side}:${piece.kind}` : "."))
    .join(",");
  const repetitions = Object.entries(state.positionCounts)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([position, count]) => `${position}:${count}`)
    .join(";");
  return hashString(
    `${board}|${state.turnSeat}|${state.moveCount}|${state.halfmoveClock}|${Number(state.inCheck)}|${Number(state.finished)}|${state.winnerSeat ?? "-"}|${state.resultReason ?? "-"}|${hashString(repetitions)}`,
  );
}

const XIANGQI_ONLINE: OnlineGame<
  XiangqiState,
  XiangqiMove,
  XiangqiPresentation
> = {
  game: xiangqiGame,
  initialState: createInitialXiangqiState,
  hash: hashXiangqiState,
};

export function XiangqiOnlineFlow({
  onPlayingChange,
  onExit,
  onFinishedChange,
}: {
  onPlayingChange: (playing: boolean) => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { owner, ready } = useOnlineRoom<XiangqiMove>(XIANGQI_GAME_ID);
  useEffect(() => {
    onPlayingChange(ready !== null);
  }, [ready, onPlayingChange]);
  if (!ready) {
    return (
      <OnlineLobby<XiangqiMove>
        gameId={XIANGQI_GAME_ID}
        parseMove={parseXiangqiMove}
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
  session: OnlineMatchSession<XiangqiMove>;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((state) => state.gamesVolume);

  const present = (
    resolution: MoveResolution<XiangqiState, XiangqiPresentation>,
  ) => {
    playMoveSound(volume, resolution.presentation.captured !== null);
    if (resolution.state.resultReason === "checkmate") {
      playCheckSound(volume, true);
    } else if (resolution.state.inCheck) {
      playCheckSound(volume);
    } else if (resolution.state.finished) {
      playFinishSound(volume);
    }
  };

  const {
    controller,
    snapshot,
    undoFlow,
    endReason,
    rematchWaiting,
    rematchIncoming,
  } = useOnlineMatch(session, XIANGQI_ONLINE, present);
  const mode: XiangqiMode = { kind: "online" };
  return (
    <>
      {/* 重赛由控制器换 round；视图按 round 重建以复位结果条与历史录制。 */}
      <XiangqiMatchView
        key={snapshot.round}
        mode={mode}
        session={{
          runner: snapshot.match.runner,
          local: snapshot.match.local,
        }}
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
