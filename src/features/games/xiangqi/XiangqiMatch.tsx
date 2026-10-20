import { Plural, Trans } from "@lingui/react/macro";
import { Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useSettingsStore } from "~/store/settings";

import { BoardMatchLayout } from "../engine/BoardMatchLayout";
import { GameResultBar } from "../engine/GameResultBar";
import { useGamesHistoryStore } from "../engine/history";
import { useMatchSnapshot } from "../engine/match";
import type { SeatIndex } from "../engine/types";
import { useLocalGameSession } from "../engine/use-game-session";
import { playCheckSound, playFinishSound, playMoveSound } from "./audio";
import { matchResultLabel, resultReasonLabel, sideName } from "./labels";
import { legalMoves } from "./rules";
import { xiangqiSessions } from "./session";
import {
  XIANGQI_GAME_ID,
  type XiangqiHistoryPayload,
  type XiangqiMode,
  type XiangqiSession,
} from "./types";
import { XiangqiStage } from "./XiangqiStage";

export function XiangqiMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: Exclude<
    XiangqiMode,
    {
      kind: "online";
    }
  >;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((state) => state.gamesVolume);
  const session = useLocalGameSession(xiangqiSessions, ({ resolution }) => {
    playMoveSound(volume, resolution.presentation.captured !== null);
    if (resolution.state.resultReason === "checkmate")
      playCheckSound(volume, true);
    else if (resolution.state.inCheck) playCheckSound(volume);
    else if (resolution.state.finished) playFinishSound(volume);
  });
  if (!session) return <div className="flex-1" />;
  return (
    <XiangqiMatchView
      mode={mode}
      session={session}
      onRematch={onRematch}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
    />
  );
}

export interface XiangqiOnlineViewProps {
  peerName: string;
  localSeat: SeatIndex;
  undoWaiting: boolean;
  rematchWaiting: boolean;
  onRequestUndo(plies: number): void;
}

export function XiangqiMatchView({
  mode,
  session,
  onRematch,
  onExit,
  online,
  onFinishedChange,
}: {
  mode: XiangqiMode;
  session: XiangqiSession;
  onRematch: () => void;
  onExit: () => void;
  online?: XiangqiOnlineViewProps;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const addRecord = useGamesHistoryStore((store) => store.addRecord);
  const recordedRef = useRef(false);
  const activeIsLocal =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "local";
  const aiThinking =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat !== null &&
    runner.controllers[snapshot.activeSeat]?.kind === "ai";
  const localSeat =
    mode.kind === "online"
      ? (online?.localSeat ?? 0)
      : mode.kind === "ai"
        ? mode.localSeat
        : 0;
  const undoPlies =
    (mode.kind === "ai" || mode.kind === "online") &&
    snapshot.activeSeat === localSeat
      ? 2
      : 1;
  const canUndo =
    snapshot.phase === "awaiting-move" &&
    state.moveCount >= undoPlies &&
    !online?.undoWaiting;
  const currentLegalMoves = activeIsLocal ? legalMoves(state) : [];
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);
  useEffect(() => {
    if (!state.finished || !state.resultReason || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: runner.id,
      gameId: XIANGQI_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: snapshot.winnerSeat,
        reason: state.resultReason,
        moves: state.moveCount,
        localSeat:
          mode.kind === "online"
            ? online?.localSeat
            : mode.kind === "ai"
              ? mode.localSeat
              : undefined,
      } satisfies XiangqiHistoryPayload,
    });
    // 本挂载对局只记录一次结果（由 recordedRef 守卫）；此 keyed 实例的
    // 每个依赖都稳定。
  }, [
    addRecord,
    runner.id,
    mode,
    online,
    snapshot.winnerSeat,
    state.finished,
    state.moveCount,
    state.resultReason,
  ]);
  const sideNameValue = sideName(mode, state.turnSeat, online);
  return (
    <>
      <BoardMatchLayout
        title={
          state.finished ? (
            matchResultLabel(mode, snapshot.winnerSeat, online)
          ) : (
            <Trans>轮到 {sideNameValue}</Trans>
          )
        }
        mode={mode}
        localSeat={localSeat}
        red
        finished={state.finished}
        status={
          <>
            <Badge variant="outline">
              <Plural
                value={{
                  moveNumber: state.moveCount + (state.finished ? 0 : 1),
                }}
                one="第 # 手"
                other="第 # 手"
              />
            </Badge>
            {state.inCheck ? (
              <Badge className="bg-chess-red text-white">
                <Trans>将军</Trans>
              </Badge>
            ) : null}
            {aiThinking ? (
              <Badge variant="outline">
                <Trans>电脑思考中…</Trans>
              </Badge>
            ) : null}
            {online &&
            !state.finished &&
            snapshot.phase === "awaiting-move" &&
            snapshot.activeSeat !== online.localSeat ? (
              <Badge variant="outline">
                <Trans>等待对方落子…</Trans>
              </Badge>
            ) : null}
            {online?.undoWaiting ? (
              <Badge variant="outline">
                <Trans>等待对方同意悔棋…</Trans>
              </Badge>
            ) : null}
          </>
        }
        controls={
          <>
            <Button
              variant="outline"
              size="sm"
              density="adaptive"
              disabled={!canUndo}
              onClick={() =>
                online
                  ? online.onRequestUndo(undoPlies)
                  : runner.undo(undoPlies)
              }
            >
              <Undo2 data-icon="inline-start" />
              <Trans>悔棋</Trans>
            </Button>
          </>
        }
      >
        <XiangqiStage
          board={state.board}
          turnSeat={state.turnSeat}
          legalMoves={currentLegalMoves}
          lastMove={state.lastMove}
          inCheck={state.inCheck}
          interactive={activeIsLocal && !state.finished}
          flipped={
            mode.kind === "online"
              ? online?.localSeat === 1
              : mode.kind === "ai" && mode.localSeat === 1
          }
          onPlay={(move) => local.submit(move)}
        />
      </BoardMatchLayout>
      {state.finished ? (
        <GameResultBar
          title={matchResultLabel(mode, snapshot.winnerSeat, online)}
          celebrate={
            snapshot.winnerSeat !== null &&
            (mode.kind === "hotseat" || snapshot.winnerSeat === localSeat)
          }
          details={
            <span>
              {resultReasonLabel(state.resultReason)} ·{" "}
              <Plural
                value={{
                  moveCount: state.moveCount,
                }}
                one="共 # 手"
                other="共 # 手"
              />
            </span>
          }
          rematchWaiting={online?.rematchWaiting}
          onRematch={onRematch}
          onExit={onExit}
        />
      ) : null}
    </>
  );
}
