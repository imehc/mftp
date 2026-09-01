/**
 * 联机（局域网）流程：大厅交接、带悔棋/再来一局同意对话框的网络对局
 * 封装，以及断线处理。
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
import { playFinishSound, playStoneSound } from "./audio";
import { GomokuMatchView } from "./GomokuMatch";
import { createInitialGomokuState, gomokuGame } from "./rules";
import {
  GOMOKU_GAME_ID,
  type GomokuMode,
  type GomokuMove,
  type GomokuSession,
  type GomokuState,
} from "./types";

/** 分歧触发器，与对端的 RemoteMove.stateHash 比对。 */
function hashGomokuState(state: GomokuState): string {
  const cells = state.board
    .map((stone) => (stone === null ? "." : String(stone)))
    .join("");
  return hashString(`${cells}|${state.turnSeat}|${state.moveCount}`);
}
export function GomokuOnlineFlow({
  onExit,
  onFinishedChange,
}: {
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const [ready, setReady] = useState<{
    session: OnlineMatchSession<GomokuMove>;
    status: GameRoomStatus;
  } | null>(null);
  const readyRef = useRef(ready);
  // 最新值 ref 在 effect 中同步，而非渲染期间。
  useEffect(() => {
    readyRef.current = ready;
  });

  // 退出联机模式总会拆除房间。
  useEffect(
    () => () => {
      readyRef.current?.session.close();
      void gameRoomLeave().catch(() => {});
    },
    [],
  );
  if (!ready) {
    return (
      <OnlineLobby<GomokuMove> gameId={GOMOKU_GAME_ID} onReady={setReady} />
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
  const { t } = useLingui();
  const volume = useSettingsStore((s) => s.gamesVolume);
  const [nonce, setNonce] = useState(0);
  const [match, setMatch] = useState<GomokuSession | null>(null);
  const [undoFlow, setUndoFlow] = useState<UndoFlow>(null);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchIncoming, setRematchIncoming] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);
  const lastRemoteRef = useRef<RemoteMove<GomokuMove> | null>(null);
  const matchRef = useRef<GomokuSession | null>(null);
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
    });
    // 交替先手：每次再来一局座位互换。双方都通过同意流程自增 `nonce`，
    // 因此奇偶（进而座位映射）保持锁步，无需额外协议。
    const seatThisRound: SeatIndex =
      nonce % 2 === 0
        ? session.localSeat
        : ((1 - session.localSeat) as SeatIndex);
    const local = new LocalController<GomokuState, GomokuMove>();
    const remote = new RemoteController<GomokuState, GomokuMove>();
    const controllers: PlayerController<GomokuState, GomokuMove>[] =
      seatThisRound === 0 ? [local, remote] : [remote, local];
    const runner = new MatchRunner(
      gomokuGame,
      createInitialGomokuState(),
      controllers,
      {
        onMoveResolved: ({ seat, move, moveIndex, resolution }) => {
          playStoneSound(volumeRef.current);
          if (resolution.state.finished) playFinishSound(volumeRef.current);
          const hash = hashGomokuState(resolution.state);
          if (seat === seatThisRound) {
            void session
              .sendMove({
                seq: moveIndex,
                seat,
                move,
                stateHash: hash,
              })
              .catch(() => {
                setEndReason(tRef.current`消息发送失败，连接可能已断开。`);
              });
          } else if (
            lastRemoteRef.current &&
            lastRemoteRef.current.stateHash !== hash
          ) {
            setEndReason(tRef.current`双方棋局状态不一致，本局无法继续。`);
          }
        },
        onError: (error) => console.error("gomoku online match error", error),
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
    // 音量按每手读取；局中改变音量不得重建 runner。
  }, [nonce, session]);

  /** 将双方回退到同一绝对手数索引。 */
  const applyUndo = (atMove: number, plies: number) => {
    const runner = matchRef.current?.runner;
    if (!runner) return;
    const target = Math.max(0, atMove - plies);
    const current = runner.getSnapshot().moveCount;
    if (current > target) runner.undo(current - target);
  };
  useEffect(() => {
    const offControl = session.onControl((msg) => {
      if (msg.t === "undo-request") {
        setUndoFlow({
          kind: "incoming",
          atMove: msg.atMove,
          plies: msg.plies,
        });
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
    // applyUndo 只读取 ref；每次渲染重新订阅没有意义。
  }, [session, t]);
  const requestUndo = (plies: number) => {
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
  const respondUndo = (accept: boolean) => {
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
  const requestRematch = () => {
    if (rematchWaiting) return;
    setRematchWaiting(true);
    void session
      .sendControl({
        t: "rematch-request",
      })
      .catch(() => setRematchWaiting(false));
  };
  const respondRematch = (accept: boolean) => {
    setRematchIncoming(false);
    void session
      .sendControl({
        t: "rematch-response",
        accept,
      })
      .catch(() => {});
    if (accept) setNonce((n) => n + 1);
  };
  if (!match) return <div className="flex-1" />;
  const mode: GomokuMode = {
    kind: "online",
  };
  const gameSeat: SeatIndex =
    nonce % 2 === 0
      ? session.localSeat
      : ((1 - session.localSeat) as SeatIndex);
  return (
    <>
      <GomokuMatchView
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
