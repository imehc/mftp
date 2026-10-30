import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { RotateCw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LightNoticeMessage } from "~/components/LightNotice";
import { useSettingsStore } from "~/store/settings";

import { BoardMatchLayout } from "../engine/BoardMatchLayout";
import { GameResultBar } from "../engine/GameResultBar";
import { GameMenuActionButton, GameToolbarAction } from "../engine/GameToolbar";
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
  notice?: LightNoticeMessage | null;
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
  const [reversed, setReversed] = useState(false);
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
  const { t } = useLingui();
  const sideNameValue = sideName(mode, state.turnSeat, online);
  return (
    <>
      <BoardMatchLayout
        notice={online?.notice}
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
        metrics={
          <>
            <span>
              <Plural
                value={{
                  moveNumber: state.moveCount + (state.finished ? 0 : 1),
                }}
                one="第 # 手"
                other="第 # 手"
              />
            </span>
            {state.inCheck ? (
              <span className="text-destructive">
                <Trans>将军</Trans>
              </span>
            ) : null}
          </>
        }
        activity={
          !state.finished ? (
            online?.undoWaiting ? (
              <Trans>等待对方同意悔棋…</Trans>
            ) : aiThinking ? (
              <Trans>电脑思考中…</Trans>
            ) : online && snapshot.activeSeat !== online.localSeat ? (
              <Trans>等待对方落子…</Trans>
            ) : null
          ) : null
        }
        controls={
          <>
            <GameToolbarAction
              icon={Undo2}
              label={t`悔棋`}
              disabled={!canUndo}
              onClick={() =>
                online
                  ? online.onRequestUndo(undoPlies)
                  : runner.undo(undoPlies)
              }
            />
          </>
        }
        menuActions={
          <GameMenuActionButton
            icon={RotateCw}
            aria-pressed={reversed}
            onClick={() => setReversed((value) => !value)}
          >
            <Trans>翻转棋盘</Trans>
          </GameMenuActionButton>
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
            (mode.kind === "online"
              ? online?.localSeat === 1
              : mode.kind === "ai" && mode.localSeat === 1) !== reversed
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
