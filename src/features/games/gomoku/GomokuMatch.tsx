/**
 * 本地对局装配（人机 / 同屏）以及本地与联机共用的对局视图：状态栏、
 * 棋盘舞台与结果条。
 */
import { useEffect, useRef, useState } from "react";
import { Plural, Trans } from "@lingui/react/macro";
import { Undo2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useSettingsStore } from "~/store/settings";
import { AiController, LocalController } from "../engine/controllers";
import { useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import type { PlayerController, SeatIndex } from "../engine/types";
import { GameResultBar } from "../engine/GameResultBar";
import { gomokuAiStrategy } from "./ai";
import { playFinishSound, playStoneSound } from "./audio";
import { GomokuStage } from "./GomokuStage";
import { matchResultLabel, seatName } from "./labels";
import { createInitialGomokuState, gomokuGame } from "./rules";
import {
  GOMOKU_GAME_ID,
  type GomokuHistoryPayload,
  type GomokuMode,
  type GomokuMove,
  type GomokuSession,
  type GomokuState,
} from "./types";

/** 对局走局域网房间通道时额外的视图状态。 */
export interface OnlineViewProps {
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
  const [session, setSession] = useState<GomokuSession | null>(null);
  const volume = useSettingsStore((s) => s.gamesVolume);
  // runner 每个 keyed 实例只构建一次；音量通过最新值 ref 读取，
  // 以免对局中途改音量导致 runner 重建。
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  useEffect(() => {
    const local = new LocalController<GomokuState, GomokuMove>();
    let controllers: PlayerController<GomokuState, GomokuMove>[];
    if (mode.kind === "hotseat") {
      controllers = [local, local];
    } else {
      const ai = new AiController(
        gomokuAiStrategy,
        mode.kind === "ai" ? mode.difficulty : "medium",
        350,
      );
      // 执白即后手：AI 占据 0 号位（黑），由它开局。
      controllers =
        mode.kind === "ai" && mode.localSeat === 1 ? [ai, local] : [local, ai];
    }
    const runner = new MatchRunner(
      gomokuGame,
      createInitialGomokuState(),
      controllers,
      {
        onMoveResolved: ({ resolution }) => {
          playStoneSound(volumeRef.current);
          if (resolution.state.finished) playFinishSound(volumeRef.current);
        },
        onError: (error) => console.error("gomoku match error", error),
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
    // 每个 <GomokuMatch key=...> 实例的 mode 标识是稳定的。
  }, [mode]);
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
    if (!state.finished) {
      // 用微任务延迟，使 setState 发生在 effect 主体之外。
      queueMicrotask(() => setShowResult(false));
      return;
    }
    const timer = setTimeout(
      () => setShowResult(true),
      state.winningLine.length > 0 ? 1600 : 500,
    );
    return () => clearTimeout(timer);
  }, [state.finished, state.winningLine.length]);
  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: crypto.randomUUID(),
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
    mode,
    online,
    snapshot.winnerSeat,
    state.finished,
    state.moveCount,
  ]);
  const seatNameValue = seatName(mode, state.turnSeat, online);
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
        <GomokuStage
          board={state.board}
          lastMove={state.lastMove}
          winningLine={state.winningLine}
          ghostSeat={state.turnSeat}
          interactive={activeIsLocal && !state.finished}
          onPlay={(move) => local.submit(move)}
        />
      </div>
      {state.finished && showResult ? (
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
