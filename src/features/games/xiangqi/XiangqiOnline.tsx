/** 局域网中国象棋流程：锁步走子、悔棋同意、再来一局。 */
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
import { playCheckSound, playFinishSound, playMoveSound } from "./audio";
import { XiangqiMatchView } from "./XiangqiMatch";
import { createInitialXiangqiState, xiangqiGame } from "./rules";
import {
  XIANGQI_GAME_ID,
  type XiangqiMode,
  type XiangqiMove,
  type XiangqiSession,
  type XiangqiState,
} from "./types";
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
export function XiangqiOnlineFlow({
  onExit,
  onFinishedChange,
}: {
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const [ready, setReady] = useState<{
    session: OnlineMatchSession<XiangqiMove>;
    status: GameRoomStatus;
  } | null>(null);
  const readyRef = useRef(ready);
  // 最新值 ref 在 effect 中同步，而非渲染期间。
  useEffect(() => {
    readyRef.current = ready;
  });
  useEffect(
    () => () => {
      readyRef.current?.session.close();
      void gameRoomLeave().catch(() => {});
    },
    [],
  );
  if (!ready) {
    return (
      <OnlineLobby<XiangqiMove> gameId={XIANGQI_GAME_ID} onReady={setReady} />
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
  const { t } = useLingui();
  const volume = useSettingsStore((state) => state.gamesVolume);
  const [nonce, setNonce] = useState(0);
  const [match, setMatch] = useState<XiangqiSession | null>(null);
  const [undoFlow, setUndoFlow] = useState<UndoFlow>(null);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchIncoming, setRematchIncoming] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);
  const lastRemoteRef = useRef<RemoteMove<XiangqiMove> | null>(null);
  const matchRef = useRef<XiangqiSession | null>(null);
  useEffect(() => {
    matchRef.current = match;
  });
  // 对局 effect 不能在局中重建 runner，因此音量与译文都通过最新值 ref
  // 在其回调内部读取。
  const volumeRef = useRef(volume);
  const tRef = useRef(t);
  useEffect(() => {
    volumeRef.current = volume;
    tRef.current = t;
  }, [volume, t]);
  useEffect(() => {
    lastRemoteRef.current = null;
    // 用微任务延迟，使重置发生在 effect 主体之外。
    queueMicrotask(() => {
      setUndoFlow(null);
      setRematchWaiting(false);
      setRematchIncoming(false);
      setEndReason(null);
    });
    const seatThisRound: SeatIndex =
      nonce % 2 === 0
        ? session.localSeat
        : ((1 - session.localSeat) as SeatIndex);
    const local = new LocalController<XiangqiState, XiangqiMove>();
    const remote = new RemoteController<XiangqiState, XiangqiMove>();
    const controllers: PlayerController<XiangqiState, XiangqiMove>[] =
      seatThisRound === 0 ? [local, remote] : [remote, local];
    const runner = new MatchRunner(
      xiangqiGame,
      createInitialXiangqiState(),
      controllers,
      {
        onMoveResolved: ({ seat, move, moveIndex, resolution }) => {
          playMoveSound(
            volumeRef.current,
            resolution.presentation.captured !== null,
          );
          if (resolution.state.resultReason === "checkmate") {
            playCheckSound(volumeRef.current, true);
          } else if (resolution.state.inCheck) {
            playCheckSound(volumeRef.current);
          } else if (resolution.state.finished) {
            playFinishSound(volumeRef.current);
          }
          const stateHash = hashXiangqiState(resolution.state);
          if (seat === seatThisRound) {
            void session
              .sendMove({
                seq: moveIndex,
                seat,
                move,
                stateHash,
              })
              .catch(() =>
                setEndReason(tRef.current`消息发送失败，连接可能已断开。`),
              );
          } else if (
            lastRemoteRef.current &&
            lastRemoteRef.current.stateHash !== stateHash
          ) {
            setEndReason(tRef.current`双方棋局状态不一致，本局无法继续。`);
          }
        },
        onError: (error) => {
          console.error("xiangqi online match error", error);
          setEndReason(tRef.current`双方棋局状态不一致，本局无法继续。`);
        },
      },
    );
    const offMove = session.onRemoteMove((remoteMove) => {
      lastRemoteRef.current = remoteMove;
      remote.push(remoteMove.move);
    });
    runner.start();
    setMatch({
      runner,
      local,
    });
    return () => {
      offMove();
      runner.dispose();
      setMatch(null);
    };
    // 仅 nonce 即可开启再来一局；音量/t 通过上方 ref 读取。
  }, [nonce, session]);
  const applyUndo = (atMove: number, plies: number): void => {
    const runner = matchRef.current?.runner;
    if (!runner) return;
    const target = Math.max(0, atMove - plies);
    const current = runner.getSnapshot().moveCount;
    if (current > target) runner.undo(current - target);
  };
  useEffect(() => {
    const offControl = session.onControl((message) => {
      if (message.t === "undo-request") {
        setUndoFlow({
          kind: "incoming",
          atMove: message.atMove,
          plies: message.plies,
        });
      } else if (message.t === "undo-response") {
        setUndoFlow((flow) => (flow?.kind === "waiting" ? null : flow));
        if (message.accept) applyUndo(message.atMove, message.plies);
        else toast(t`对方拒绝了悔棋`);
      } else if (message.t === "rematch-request") {
        setRematchIncoming(true);
      } else if (message.t === "rematch-response") {
        setRematchWaiting(false);
        if (message.accept) setNonce((value) => value + 1);
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
    // applyUndo 只读取 ref，因此每次渲染重新订阅没有必要。
  }, [session, t]);
  const requestUndo = (plies: number): void => {
    const runner = matchRef.current?.runner;
    if (!runner || undoFlow !== null) return;
    const atMove = runner.getSnapshot().moveCount;
    setUndoFlow({
      kind: "waiting",
    });
    void session
      .sendControl({
        t: "undo-request",
        atMove,
        plies,
      })
      .catch(() => setUndoFlow(null));
  };
  const respondUndo = (accept: boolean): void => {
    const flow = undoFlow;
    if (flow?.kind !== "incoming") return;
    setUndoFlow(null);
    if (accept) applyUndo(flow.atMove, flow.plies);
    void session
      .sendControl({
        t: "undo-response",
        accept,
        atMove: flow.atMove,
        plies: flow.plies,
      })
      .catch(() => {});
  };
  const requestRematch = (): void => {
    if (rematchWaiting) return;
    setRematchWaiting(true);
    void session
      .sendControl({
        t: "rematch-request",
      })
      .catch(() => setRematchWaiting(false));
  };
  const respondRematch = (accept: boolean): void => {
    setRematchIncoming(false);
    void session
      .sendControl({
        t: "rematch-response",
        accept,
      })
      .catch(() => {});
    if (accept) setNonce((value) => value + 1);
  };
  if (!match) return <div className="flex-1" />;
  const mode: XiangqiMode = {
    kind: "online",
  };
  const gameSeat: SeatIndex =
    nonce % 2 === 0
      ? session.localSeat
      : ((1 - session.localSeat) as SeatIndex);
  return (
    <>
      <XiangqiMatchView
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
      <OnlineMatchDialogs
        undoFlow={undoFlow}
        onRespondUndo={respondUndo}
        rematchIncoming={rematchIncoming}
        onRespondRematch={respondRematch}
        endReason={endReason}
        onExit={onExit}
      />
    </>
  );
}
