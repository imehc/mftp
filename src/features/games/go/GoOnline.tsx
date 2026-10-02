import { useEffect } from "react";
/**
 * 联机（局域网）流程：大厅交接 + 共享对局控制器的网络对局视图接线。
 * 棋盘规格通过游戏 id（go-9 / go-13 / go-19）协商，使双方总能构建
 * 完全一致的初始局面；走法时序与悔棋/重赛协商由 OnlineMatchController 收口。
 */
import { useSettingsStore } from "~/store/settings";
import { OnlineLobby } from "../engine/online/OnlineLobby";
import { OnlineMatchDialogs } from "../engine/online/OnlineMatchDialogs";
import type { OnlineGame } from "../engine/online/matchTypes";
import { OnlineMatchSession, hashString } from "../engine/online/session";
import { useOnlineRoom } from "../engine/online/useOnlineRoom";
import { useOnlineMatch } from "../engine/online/useOnlineMatch";
import type { MoveResolution } from "../engine/types";
import { playCaptureSound, playFinishSound, playStoneSound } from "./audio";
import { GoMatchView } from "./GoMatch";
import { goMoveParser } from "./onlineProtocol";
import { createInitialGoState, goGame } from "./rules";
import {
  GO_GAME_ID,
  type BoardSize,
  type GoMode,
  type GoMove,
  type GoPresentation,
  type GoState,
} from "./types";

/** 分歧触发器，与对端的 RemoteMove.stateHash 比对。 */
function hashGoState(state: GoState): string {
  const cells = state.board
    .map((stone) => (stone === null ? "." : String(stone)))
    .join("");
  return hashString(
    `${cells}|${state.turnSeat}|${state.moveCount}|${state.koPoint}|${state.consecutivePasses}|${hashString(state.positionHistory.join("|"))}`,
  );
}

// 定义按棋盘规格固定于模块级：其身份变化不得重建对局控制器。
const GO_ONLINE: Record<
  BoardSize,
  OnlineGame<GoState, GoMove, GoPresentation>
> = {
  9: {
    game: goGame,
    initialState: () => createInitialGoState(9),
    hash: hashGoState,
  },
  13: {
    game: goGame,
    initialState: () => createInitialGoState(13),
    hash: hashGoState,
  },
  19: {
    game: goGame,
    initialState: () => createInitialGoState(19),
    hash: hashGoState,
  },
};

export function GoOnlineFlow({
  boardSize,
  onPlayingChange,
  onExit,
  onFinishedChange,
}: {
  boardSize: BoardSize;
  onPlayingChange: (playing: boolean) => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { owner, ready } = useOnlineRoom<GoMove>(`${GO_GAME_ID}-${boardSize}`);
  useEffect(() => {
    onPlayingChange(ready !== null);
  }, [ready, onPlayingChange]);
  if (!ready) {
    return (
      <OnlineLobby<GoMove>
        gameId={`${GO_GAME_ID}-${boardSize}`}
        parseMove={goMoveParser(boardSize)}
        owner={owner}
        onExit={onExit}
      />
    );
  }
  return (
    <OnlineMatch
      session={ready.session}
      boardSize={boardSize}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
    />
  );
}

function OnlineMatch({
  session,
  boardSize,
  onExit,
  onFinishedChange,
}: {
  session: OnlineMatchSession<GoMove>;
  boardSize: BoardSize;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((s) => s.gamesVolume);
  const present = (resolution: MoveResolution<GoState, GoPresentation>) => {
    if (resolution.presentation.captured.length > 0) playCaptureSound(volume);
    else playStoneSound(volume);
    if (resolution.state.finished) playFinishSound(volume);
  };
  const {
    controller,
    snapshot,
    undoFlow,
    endReason,
    rematchWaiting,
    rematchIncoming,
  } = useOnlineMatch(session, GO_ONLINE[boardSize], present);
  const mode: GoMode = { kind: "online", boardSize };
  return (
    <>
      {/* 重赛由控制器换 round；视图按 round 重建以复位结果条与历史录制。 */}
      <GoMatchView
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
