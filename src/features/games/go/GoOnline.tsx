/**
 * Online (LAN) flow: lobby handoff, the networked match wrapper with
 * undo / rematch consent dialogs, and connection-loss handling.
 * Board size is negotiated through the game id (go-9 / go-13 / go-19)
 * so both peers always build identical initial states.
 */
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { gameRoomLeave } from "~/lib/ipc";
import { useSettingsStore } from "~/store/settings";
import type { GameRoomStatus } from "~/types";
import { LocalController, RemoteController } from "../engine/controllers";
import { MatchRunner } from "../engine/match";
import { OnlineLobby } from "../engine/online/OnlineLobby";
import {
  OnlineMatchDialogs,
  type UndoFlow,
} from "../engine/online/OnlineMatchDialogs";
import { hashString, OnlineMatchSession } from "../engine/online/session";
import type { RemoteMove } from "../engine/transport";
import type { PlayerController, SeatIndex } from "../engine/types";
import { playCaptureSound, playFinishSound, playStoneSound } from "./audio";
import { GoMatchView } from "./GoMatch";
import { createInitialGoState, goGame } from "./rules";
import {
  GO_GAME_ID,
  type BoardSize,
  type GoMode,
  type GoMove,
  type GoSession,
  type GoState,
} from "./types";

/** Divergence tripwire compared against the peer's RemoteMove.stateHash. */
function hashGoState(state: GoState): string {
  const cells = state.board
    .map((stone) => (stone === null ? "." : String(stone)))
    .join("");
  return hashString(
    `${cells}|${state.turnSeat}|${state.moveCount}|${state.koPoint}|${state.consecutivePasses}|${hashString(state.positionHistory.join("|"))}`,
  );
}

export function GoOnlineFlow({
  boardSize,
  onExit,
  onFinishedChange,
}: {
  boardSize: BoardSize;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const [ready, setReady] = useState<{
    session: OnlineMatchSession<GoMove>;
    status: GameRoomStatus;
  } | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Leaving online mode always tears the room down.
  useEffect(
    () => () => {
      readyRef.current?.session.close();
      void gameRoomLeave().catch(() => {});
    },
    [],
  );

  if (!ready) {
    return (
      <OnlineLobby<GoMove>
        gameId={`${GO_GAME_ID}-${boardSize}`}
        onReady={setReady}
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
  const { t } = useLingui();
  const volume = useSettingsStore((s) => s.gamesVolume);
  const [nonce, setNonce] = useState(0);
  const [match, setMatch] = useState<GoSession | null>(null);
  const [undoFlow, setUndoFlow] = useState<UndoFlow>(null);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchIncoming, setRematchIncoming] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);
  const lastRemoteRef = useRef<RemoteMove<GoMove> | null>(null);
  const matchRef = useRef<GoSession | null>(null);
  matchRef.current = match;

  useEffect(() => {
    lastRemoteRef.current = null;
    setUndoFlow(null);
    setRematchWaiting(false);
    setRematchIncoming(false);
    // Alternating first move: seats swap every rematch. Both peers bump `nonce` through the
    // consent flow, so parity — and thus the seat mapping — stays in
    // lockstep without extra protocol.
    const seatThisRound: SeatIndex =
      nonce % 2 === 0 ? session.localSeat : ((1 - session.localSeat) as SeatIndex);
    const local = new LocalController<GoState, GoMove>();
    const remote = new RemoteController<GoState, GoMove>();
    const controllers: PlayerController<GoState, GoMove>[] =
      seatThisRound === 0 ? [local, remote] : [remote, local];
    const runner = new MatchRunner(
      goGame,
      createInitialGoState(boardSize),
      controllers,
      {
        onMoveResolved: ({ seat, move, moveIndex, resolution }) => {
          if (resolution.presentation.captured.length > 0) playCaptureSound(volume);
          else playStoneSound(volume);
          if (resolution.state.finished) playFinishSound(volume);
          const hash = hashGoState(resolution.state);
          if (seat === seatThisRound) {
            void session
              .sendMove({ seq: moveIndex, seat, move, stateHash: hash })
              .catch(() => {
                setEndReason(t`消息发送失败，连接可能已断开。`);
              });
          } else if (
            lastRemoteRef.current &&
            lastRemoteRef.current.stateHash !== hash
          ) {
            setEndReason(t`双方棋局状态不一致，本局无法继续。`);
          }
        },
        onError: (error) => console.error("go online match error", error),
      },
    );
    const offMove = session.onRemoteMove((remoteMove) => {
      lastRemoteRef.current = remoteMove;
      remote.push(remoteMove.move);
    });
    runner.start();
    setMatch({ runner, local });
    return () => {
      offMove();
      runner.dispose();
      setMatch(null);
    };
    // nonce drives rematches; the rest is stable for the session lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, session, boardSize]);

  useEffect(() => {
    const applyUndo = (atMove: number, plies: number) => {
      const runner = matchRef.current?.runner;
      if (!runner) return;
      if (runner.getSnapshot().moveCount === atMove) runner.undo(plies);
    };
    const offControl = session.onControl((msg) => {
      if (msg.t === "undo-request") {
        setUndoFlow({ kind: "incoming", atMove: msg.atMove, plies: msg.plies });
      } else if (msg.t === "undo-response") {
        setUndoFlow((flow) => (flow?.kind === "waiting" ? null : flow));
        if (msg.accept) applyUndo(msg.atMove, msg.plies);
        else toast(t`对方拒绝了悔棋`);
      } else if (msg.t === "rematch-request") {
        setRematchIncoming(true);
      } else if (msg.t === "rematch-response") {
        setRematchWaiting(false);
        if (msg.accept) setNonce((n) => n + 1);
        else toast(t`对方拒绝了再来一局`);
      }
    });
    const offPresence = session.onPeerPresence((connected) => {
      if (!connected) setEndReason(t`对方已离开房间。`);
    });
    const offClosed = session.onClosed(() => {
      setEndReason(t`与对方的连接已断开。`);
    });
    return () => {
      offControl();
      offPresence();
      offClosed();
    };
    // applyUndo only reads refs; resubscribing per render is pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, t]);

  const requestUndo = (plies: number) => {
    const runner = matchRef.current?.runner;
    if (!runner || undoFlow !== null) return;
    const atMove = runner.getSnapshot().moveCount;
    setUndoFlow({ kind: "waiting" });
    void session
      .sendControl({ t: "undo-request", atMove, plies })
      .catch(() => setUndoFlow(null));
  };

  const respondUndo = (accept: boolean) => {
    const flow = undoFlow;
    if (flow?.kind !== "incoming") return;
    setUndoFlow(null);
    const runner = matchRef.current?.runner;
    if (accept && runner && runner.getSnapshot().moveCount === flow.atMove) {
      runner.undo(flow.plies);
    }
    void session
      .sendControl({
        t: "undo-response",
        accept,
        atMove: flow.atMove,
        plies: flow.plies,
      })
      .catch(() => {});
  };

  const requestRematch = () => {
    if (rematchWaiting) return;
    setRematchWaiting(true);
    void session
      .sendControl({ t: "rematch-request" })
      .catch(() => setRematchWaiting(false));
  };

  const respondRematch = (accept: boolean) => {
    setRematchIncoming(false);
    void session.sendControl({ t: "rematch-response", accept }).catch(() => {});
    if (accept) setNonce((n) => n + 1);
  };

  if (!match) return <div className="flex-1" />;
  const mode: GoMode = { kind: "online", boardSize };
  const gameSeat: SeatIndex =
    nonce % 2 === 0 ? session.localSeat : ((1 - session.localSeat) as SeatIndex);
  return (
    <>
      <GoMatchView
        key={nonce}
        mode={mode}
        session={match}
        online={{
          peerName: session.peerName,
          localSeat: gameSeat,
          undoWaiting: undoFlow?.kind === "waiting",
          rematchWaiting,
          onRequestUndo: requestUndo,
        }}
        onRematch={requestRematch}
        onExit={onExit}
        onFinishedChange={onFinishedChange}
      />
      <OnlineMatchDialogs undoFlow={undoFlow} onRespondUndo={respondUndo} rematchIncoming={rematchIncoming} onRespondRematch={respondRematch} endReason={endReason} onExit={onExit} />
    </>
  );
}
