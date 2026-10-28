import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";

/**
 * 联机（局域网）流程：大厅交接 + 共享对局控制器的网络对局视图接线。
 * 走法/座位时序校验、悔棋与重赛协商均由 OnlineMatchController 收口。
 */
import { useSettingsStore } from "~/store/settings";

import { OnlineLobby } from "../engine/online/OnlineLobby";
import { OnlineMatchDialogs } from "../engine/online/OnlineMatchDialogs";
import { OnlineMatchSession } from "../engine/online/session";
import { useOnlineMatch } from "../engine/online/useOnlineMatch";
import { useOnlineRoom } from "../engine/online/useOnlineRoom";
import type { MoveResolution } from "../engine/types";
import { chessAudio, playChessMove } from "./audio";
import { ChessMatchView } from "./ChessMatch";
import { parseChessMove } from "./onlineProtocol";
import { CHESS_ONLINE } from "./onlineProtocol";
import {
  CHESS_GAME_ID,
  type ChessMode,
  type ChessMove,
  type ChessPresentation,
  type ChessState,
} from "./types";

export function ChessOnlineFlow({
  onPlayingChange,
  onExit,
  onFinishedChange,
}: {
  onPlayingChange: (playing: boolean) => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { owner, ready } = useOnlineRoom(CHESS_GAME_ID, CHESS_ONLINE);
  useEffect(() => {
    onPlayingChange(ready !== null);
  }, [ready, onPlayingChange]);
  if (!ready) {
    return (
      <OnlineLobby<ChessMove>
        gameId={CHESS_GAME_ID}
        parseMove={parseChessMove}
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
  session: OnlineMatchSession<ChessMove>;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((s) => s.gamesVolume);

  const present = (
    resolution: MoveResolution<ChessState, ChessPresentation>,
  ) => {
    playChessMove(volume, !!resolution.state.result);
  };

  const {
    controller,
    notice,
    snapshot,
    undoFlow,
    endReason,
    rematchWaiting,
    rematchIncoming,
  } = useOnlineMatch(session, present);
  useEffect(() => () => chessAudio.stop(), [snapshot.round]);
  const mode: ChessMode = { kind: "online" };
  return (
    <>
      {/* 重赛由控制器换 round；视图按 round 重建以复位结果条与历史录制。 */}
      <ChessMatchView
        key={snapshot.round}
        mode={mode}
        session={{ runner: snapshot.match.runner, local: snapshot.match.local }}
        online={{
          notice,
          peerName: session.peerName,
          localSeat: snapshot.localSeat,
          undoWaiting:
            snapshot.pending !== null ||
            snapshot.committing ||
            snapshot.end !== null,
          rematchWaiting,
          onRequestUndo: controller.requestUndo,
        }}
        onRematch={controller.requestRematch}
        onExit={onExit}
        onFinishedChange={onFinishedChange}
      />
      <OnlineMatchDialogs
        undoFlow={undoFlow}
        undoInformation={
          <Trans>
            同意后将回到对方最近一次走棋之前，同时恢复当时的易位、吃过路兵和重复局面记录。
          </Trans>
        }
        onRespondUndo={controller.respondUndo}
        rematchIncoming={rematchIncoming}
        onRespondRematch={controller.respondRematch}
        endReason={endReason}
        onExit={onExit}
      />
    </>
  );
}
