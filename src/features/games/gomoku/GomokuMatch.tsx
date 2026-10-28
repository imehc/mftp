/**
 * 本地对局装配（人机 / 同屏）以及本地与联机共用的对局视图：状态栏、
 * 棋盘舞台与结果条。
 */
import { Plural, Trans } from "@lingui/react/macro";
import { Undo2 } from "lucide-react";
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
import { playFinishSound, playStoneSound } from "./audio";
import { GomokuStage } from "./GomokuStage";
import { matchResultLabel, seatName } from "./labels";
import { gomokuSessions } from "./session";
import {
  GOMOKU_GAME_ID,
  type GomokuHistoryPayload,
  type GomokuMode,
  type GomokuSession,
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

export function GomokuMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: GomokuMode;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const volume = useSettingsStore((state) => state.gamesVolume);
  const session = useLocalGameSession(gomokuSessions, ({ resolution }) => {
    playStoneSound(volume);
    if (resolution.state.finished) playFinishSound(volume);
  });
  if (!session) return <div className="flex-1" />;
  return (
    <GomokuMatchView
      mode={mode}
      session={session}
      onRematch={onRematch}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
    />
  );
}

export function GomokuMatchView({
  mode,
  session,
  onRematch,
  onExit,
  online,
  onFinishedChange,
}: {
  mode: GomokuMode;
  session: GomokuSession;
  onRematch: () => void;
  onExit: () => void;
  online?: OnlineViewProps;
  onFinishedChange: (finished: boolean) => void;
}) {
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const addRecord = useGamesHistoryStore((s) => s.addRecord);
  const recordedRef = useRef(false);
  // 先压住结果条，让获胜连线闪烁先显示出来。
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
  // 悔棋回退到本地玩家的回合：对方（AI 或远程对手）已回应则退两步，
  // 对方仍在思考则退一步。联机模式走同意请求而非直接悔棋。
  const undoPlies =
    (mode.kind === "ai" || mode.kind === "online") &&
    snapshot.activeSeat === localSeat
      ? 2
      : 1;
  const canUndo =
    snapshot.phase === "awaiting-move" &&
    state.moveCount >= undoPlies &&
    !online?.undoWaiting;
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);
  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: runner.id,
      gameId: GOMOKU_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: snapshot.winnerSeat,
        moves: state.moveCount,
        localSeat:
          mode.kind === "online"
            ? online?.localSeat
            : mode.kind === "ai"
              ? mode.localSeat
              : undefined,
      } satisfies GomokuHistoryPayload,
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
    state.moveCount,
  ]);
  const seatNameValue = seatName(mode, state.turnSeat, online);
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
        <GomokuStage
          board={state.board}
          lastMove={state.lastMove}
          winningLine={state.winningLine}
          ghostSeat={state.turnSeat}
          interactive={activeIsLocal && !state.finished}
          onPlay={(move) => local.submit(move)}
        />
      </BoardMatchLayout>
      {state.finished ? (
        <GameResultBar
          title={matchResultLabel(mode, snapshot.winnerSeat, online)}
          details={
            <Plural
              value={{
                moveCount: state.moveCount,
              }}
              one="共 # 手"
              other="共 # 手"
            />
          }
          celebrate={
            snapshot.winnerSeat !== null &&
            (mode.kind === "hotseat" || snapshot.winnerSeat === localSeat)
          }
          rematchWaiting={online?.rematchWaiting}
          onRematch={onRematch}
          onExit={onExit}
        />
      ) : null}
    </>
  );
}
