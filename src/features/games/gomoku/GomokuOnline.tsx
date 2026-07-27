/**
 * Online (LAN) flow: lobby handoff, the networked match wrapper with
 * undo / rematch consent dialogs, and connection-loss handling.
 */
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { gameRoomLeave } from "~/lib/ipc";
import { useSettingsStore } from "~/store/settings";
import type { GameRoomStatus } from "~/types";
import {
  LocalController,
  RemoteController,
} from "../engine/controllers";
import { MatchRunner } from "../engine/match";
import { OnlineLobby } from "../engine/online/OnlineLobby";
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

/** Divergence tripwire compared against the peer's RemoteMove.stateHash. */
function hashGomokuState(state: GomokuState): string {
  const cells = state.board
    .map((stone) => (stone === null ? "." : String(stone)))
    .join("");
  return hashString(`${cells}|${state.turnSeat}|${state.moveCount}`);
}

export function GomokuOnlineFlow({ onExit }: { onExit: () => void }) {
  const [ready, setReady] = useState<{
    session: OnlineMatchSession<GomokuMove>;
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
    return <OnlineLobby<GomokuMove> gameId={GOMOKU_GAME_ID} onReady={setReady} />;
  }
  return <OnlineMatch session={ready.session} onExit={onExit} />;
}

type UndoFlow =
  | { kind: "waiting" }
  | { kind: "incoming"; atMove: number; plies: number }
  | null;

function OnlineMatch({
  session,
  onExit,
}: {
  session: OnlineMatchSession<GomokuMove>;
  onExit: () => void;
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
  matchRef.current = match;

  useEffect(() => {
    lastRemoteRef.current = null;
    setUndoFlow(null);
    setRematchWaiting(false);
    setRematchIncoming(false);
    // 换先: seats swap every rematch. Both peers bump `nonce` through the
    // consent flow, so parity — and thus the seat mapping — stays in
    // lockstep without extra protocol.
    const seatThisRound: SeatIndex =
      nonce % 2 === 0 ? session.localSeat : ((1 - session.localSeat) as SeatIndex);
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
          playStoneSound(volume);
          if (resolution.state.finished) playFinishSound(volume);
          const hash = hashGomokuState(resolution.state);
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
        onError: (error) => console.error("gomoku online match error", error),
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
    // volume is read per-move; a change mid-match must not rebuild the runner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, session]);

  /** Roll both peers back to the same absolute move index. */
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
      .sendControl({ t: "rematch-request" })
      .catch(() => setRematchWaiting(false));
  };

  const respondRematch = (accept: boolean) => {
    setRematchIncoming(false);
    void session.sendControl({ t: "rematch-response", accept }).catch(() => {});
    if (accept) setNonce((n) => n + 1);
  };

  if (!match) return <div className="flex-1" />;
  const mode: GomokuMode = { kind: "online" };
  const gameSeat: SeatIndex =
    nonce % 2 === 0 ? session.localSeat : ((1 - session.localSeat) as SeatIndex);
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
      />
      <AlertDialog open={undoFlow?.kind === "incoming"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对方请求悔棋</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                将撤销 {undoFlow?.kind === "incoming" ? undoFlow.plies : 0}{" "}
                手棋，是否同意？
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => respondUndo(false)}>
              <Trans>拒绝</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => respondUndo(true)}>
              <Trans>同意</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={rematchIncoming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对方想再来一局</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>同意后双方交换先后手，立即开始新对局。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => respondRematch(false)}>
              <Trans>拒绝</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => respondRematch(true)}>
              <Trans>同意</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={endReason !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>对局中断</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>{endReason}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={onExit}>
              <Trans>返回选择</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
