/**
 * 本地对局装配（人机 / 同屏）以及本地与联机共用的对局视图：状态栏、
 * 棋盘舞台与结果条。
 */
import { useEffect, useRef, useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Flag, Undo2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useSettingsStore } from "~/store/settings";
import { AiController, LocalController } from "../engine/controllers";
import { useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import type { PlayerController, SeatIndex } from "../engine/types";
import { GameResultBar } from "../engine/GameResultBar";
import { goAiStrategy } from "./ai";
import { playCaptureSound, playFinishSound, playStoneSound } from "./audio";
import { GoStage } from "./GoStage";
import { matchResultLabel, scoreLine, seatName } from "./labels";
import { cellIndex, createInitialGoState, goGame, legalPlays } from "./rules";
import {
  GO_GAME_ID,
  type GoHistoryPayload,
  type GoMode,
  type GoMove,
  type GoSession,
  type GoState,
} from "./types";

/** 对局走局域网房间通道时额外的视图状态。 */
export interface OnlineViewProps {
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
  const [session, setSession] = useState<GoSession | null>(null);
  const volume = useSettingsStore((s) => s.gamesVolume);
  // runner 每个 keyed 实例只构建一次；音量通过最新值 ref 读取，
  // 以免对局中途改音量导致 runner 重建。
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  useEffect(() => {
    const local = new LocalController<GoState, GoMove>();
    let controllers: PlayerController<GoState, GoMove>[];
    if (mode.kind === "hotseat") {
      controllers = [local, local];
    } else {
      const ai = new AiController(
        goAiStrategy,
        mode.kind === "ai" ? mode.difficulty : "medium",
        350,
      );
      // 执白即后手：AI 占据 0 号位（黑），由它开局。
      controllers =
        mode.kind === "ai" && mode.localSeat === 1 ? [ai, local] : [local, ai];
    }
    const boardSize = mode.kind === "online" ? 19 : mode.boardSize;
    const runner = new MatchRunner(
      goGame,
      createInitialGoState(boardSize),
      controllers,
      {
        onMoveResolved: ({ resolution }) => {
          if (resolution.presentation.captured.length > 0)
            playCaptureSound(volumeRef.current);
          else playStoneSound(volumeRef.current);
          if (resolution.state.finished) playFinishSound(volumeRef.current);
        },
        onError: (error) => console.error("go match error", error),
      },
    );
    runner.start();
    // 用微任务延迟，使 setState 发生在 effect 主体之外；cancelled 标记
    // 防止严格模式重挂载时发布已销毁的 runner。
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        setSession({
          runner,
          local,
        });
    });
    return () => {
      cancelled = true;
      runner.dispose();
      setSession(null);
    };
    // 每个 <GoMatch key=...> 实例的 mode 标识是稳定的。
  }, [mode]);
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
  const [showResult, setShowResult] = useState(false);
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
    if (!state.finished) {
      // 用微任务延迟，使 setState 发生在 effect 主体之外。
      queueMicrotask(() => setShowResult(false));
      return;
    }
    const timer = setTimeout(() => setShowResult(true), 700);
    return () => clearTimeout(timer);
  }, [state.finished]);
  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: crypto.randomUUID(),
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
      <div className="border-border border-b px-2 py-1 text-xs">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {state.finished ? (
            <Badge variant="secondary">
              {matchResultLabel(mode, snapshot.winnerSeat, online)}
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Trans>轮到 {seatNameValue}</Trans>
            </Badge>
          )}
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
              <Trans>AI 思考中…</Trans>
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
          <Button
            variant="outline"
            size="xs"
            disabled={!activeIsLocal || state.finished}
            title={t`停一手`}
            onClick={submitPass}
          >
            <Flag data-icon="inline-start" />
            <Trans>停一手</Trans>
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={!canUndo}
            onClick={() =>
              online ? online.onRequestUndo(undoPlies) : runner.undo(undoPlies)
            }
          >
            <Undo2 data-icon="inline-start" />
            <Trans>悔棋</Trans>
          </Button>
        </div>
      </div>
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden p-1.5">
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
      </div>
      {state.finished && showResult ? (
        <GameResultBar
          title={matchResultLabel(mode, snapshot.winnerSeat, online)}
          celebrate={
            snapshot.winnerSeat !== null &&
            (mode.kind === "hotseat" || snapshot.winnerSeat === localSeat)
          }
          details={
            <span className="flex flex-wrap justify-center gap-x-2 sm:justify-start">
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
