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
import { playFinishSound, playStoneSound, reversiAudio } from "./audio";
import { parseReversiMove } from "./onlineProtocol";
import { REVERSI_ONLINE } from "./onlineProtocol";
import { ReversiMatchView } from "./ReversiMatch";
import {
  REVERSI_GAME_ID,
  type ReversiMode,
  type ReversiMove,
  type ReversiPresentation,
  type ReversiState,
} from "./types";

export function ReversiOnlineFlow({
  onPlayingChange,
  onExit,
  onFinishedChange,
}: {
  onPlayingChange: (playing: boolean) => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { owner, ready } = useOnlineRoom(REVERSI_GAME_ID, REVERSI_ONLINE);
  useEffect(() => {
    onPlayingChange(ready !== null);
  }, [ready, onPlayingChange]);
  if (!ready) {
    return (
      <OnlineLobby<ReversiMove>
        gameId={REVERSI_GAME_ID}
        parseMove={parseReversiMove}
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
  session: OnlineMatchSession<ReversiMove>;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((s) => s.gamesVolume);

  const present = (
    resolution: MoveResolution<ReversiState, ReversiPresentation>,
  ) => {
    playStoneSound(volume);
    if (resolution.state.finished) playFinishSound(volume);
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
  useEffect(() => () => reversiAudio.stop(), [snapshot.round]);
  const mode: ReversiMode = { kind: "online" };
  return (
    <>
      {/* 重赛由控制器换 round；视图按 round 重建以复位结果条与历史录制。 */}
      <ReversiMatchView
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
            同意后将回到对方最近一次落子之前，并撤回此后的所有翻子。
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
