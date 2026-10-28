/**
 * 本地对局装配（人机 / 同屏）以及本地与联机共用的对局视图：状态栏、
 * 棋盘舞台与结果条。
 */
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Flag, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { LightNoticeMessage } from "~/components/LightNotice";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useSettingsStore } from "~/store/settings";

import { BoardMatchLayout } from "../engine/BoardMatchLayout";
import { GameResultBar } from "../engine/GameResultBar";
import { useGamesHistoryStore } from "../engine/history";
import { useMatchSnapshot } from "../engine/match";
import type { SeatIndex } from "../engine/types";
import { useLocalGameSession } from "../engine/use-game-session";
import { playCaptureSound, playFinishSound, playStoneSound } from "./audio";
import { GoStage } from "./GoStage";
import { matchResultLabel, scoreLine, seatName } from "./labels";
import { cellIndex, legalPlays } from "./rules";
import { goSessions } from "./session";
import {
  GO_GAME_ID,
  type GoHistoryPayload,
  type GoMode,
  type GoSession,
} from "./types";

/** 对局走局域网房间通道时额外的视图状态。 */
export interface OnlineViewProps {
  notice?: LightNoticeMessage | null;
  peerName: string;
  localSeat: SeatIndex;
  undoWaiting: boolean;
  rematchWaiting: boolean;
  onRequestUndo(plies: number): void;
}

export function GoMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: GoMode;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((state) => state.gamesVolume);
  const session = useLocalGameSession(goSessions, ({ resolution }) => {
    if (resolution.presentation.captured.length > 0) playCaptureSound(volume);
    else playStoneSound(volume);
    if (resolution.state.finished) playFinishSound(volume);
  });
  if (!session) return <div className="flex-1" />;
  return (
    <GoMatchView
      mode={mode}
      session={session}
      onRematch={onRematch}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
    />
  );
}

export function GoMatchView({
  mode,
  session,
  onRematch,
  onExit,
  online,
  onFinishedChange,
}: {
  mode: GoMode;
  session: GoSession;
  onRematch: () => void;
  onExit: () => void;
  online?: OnlineViewProps;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { runner, local } = session;
  const { t } = useLingui();
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const addRecord = useGamesHistoryStore((s) => s.addRecord);
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
  const legalPoints = (() => {
    const points = Array<boolean>(state.board.length).fill(false);
    if (!activeIsLocal) return points;
    for (const move of legalPlays(state)) {
      if (move.kind === "play") {
        points[cellIndex(state.boardSize, move.row, move.col)] = true;
      }
    }
    return points;
  })();
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);
  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: runner.id,
      gameId: GO_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        boardSize: state.boardSize,
        winnerSeat: snapshot.winnerSeat,
        moves: state.moveCount,
        score: state.finalScore ?? undefined,
        localSeat:
          mode.kind === "online"
            ? online?.localSeat
            : mode.kind === "ai"
              ? mode.localSeat
              : undefined,
      } satisfies GoHistoryPayload,
    });

    // 上面的 recordedRef 保证只记录一条；这里的每个依赖项在本 keyed
    // 对局实例的整个生命周期内都是稳定的。
  }, [
    addRecord,
    runner.id,
    mode,
    online,
    snapshot.winnerSeat,
    state.finished,
    state.boardSize,
    state.finalScore,
    state.moveCount,
  ]);
  const submitPass = () =>
    local.submit({
      kind: "pass",
    });
  const seatNameValue = seatName(mode, state.turnSeat, online);
  const value = state.captures[0];
  const value2 = state.captures[1];
  return (
    <>
      <BoardMatchLayout
        notice={online?.notice}
        title={
          state.finished ? (
            matchResultLabel(mode, snapshot.winnerSeat, online)
          ) : (
            <Trans>轮到 {seatNameValue}</Trans>
          )
        }
        mode={mode}
        localSeat={localSeat}
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
            <Badge variant="outline">
              <Trans>
                提子 {value}:{value2}
              </Trans>
            </Badge>
            {state.finished && state.finalScore ? (
              <Badge variant="outline">{scoreLine(state)}</Badge>
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
            {state.consecutivePasses === 1 && !state.finished ? (
              <Badge variant="outline">
                <Trans>上一手已停手：再停一手即终局，落子则重新计数</Trans>
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
              disabled={!activeIsLocal || state.finished}
              title={t`停一手`}
              onClick={submitPass}
            >
              <Flag data-icon="inline-start" />
              <Trans>停一手</Trans>
            </Button>
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
        <GoStage
          boardSize={state.boardSize}
          board={state.board}
          lastMove={state.lastMove}
          ghostSeat={state.turnSeat}
          interactive={activeIsLocal && !state.finished}
          legalPoints={legalPoints}
          onPlay={(move) => {
            if (move.kind !== "play") return;
            const index = cellIndex(state.boardSize, move.row, move.col);
            if (legalPoints[index]) local.submit(move);
          }}
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
            <span className="flex flex-wrap justify-center gap-x-2 md:justify-start">
              {state.finalScore ? <span>{scoreLine(state)}</span> : null}
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
