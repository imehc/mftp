import { useEffect, useMemo, useRef, useState } from "react";
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
import { xiangqiAiStrategy } from "./ai";
import { playCheckSound, playFinishSound, playMoveSound } from "./audio";
import { matchResultLabel, resultReasonLabel, sideName } from "./labels";
import { createInitialXiangqiState, legalMoves, xiangqiGame } from "./rules";
import {
  XIANGQI_GAME_ID,
  type XiangqiHistoryPayload,
  type XiangqiMode,
  type XiangqiMove,
  type XiangqiSession,
  type XiangqiState,
} from "./types";
import { XiangqiStage } from "./XiangqiStage";

export function XiangqiMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: Exclude<XiangqiMode, { kind: "online" }>;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const [session, setSession] = useState<XiangqiSession | null>(null);
  const volume = useSettingsStore((state) => state.gamesVolume);

  useEffect(() => {
    const local = new LocalController<XiangqiState, XiangqiMove>();
    let controllers: PlayerController<XiangqiState, XiangqiMove>[];
    if (mode.kind === "hotseat") {
      controllers = [local, local];
    } else {
      const ai = new AiController(xiangqiAiStrategy, mode.difficulty, 350);
      controllers = mode.localSeat === 0 ? [local, ai] : [ai, local];
    }
    const runner = new MatchRunner(
      xiangqiGame,
      createInitialXiangqiState(),
      controllers,
      {
        onMoveResolved: ({ resolution }) => {
          playMoveSound(volume, resolution.presentation.captured !== null);
          if (resolution.state.resultReason === "checkmate") {
            playCheckSound(volume, true);
          } else if (resolution.state.inCheck) {
            playCheckSound(volume);
          } else if (resolution.state.finished) {
            playFinishSound(volume);
          }
        },
        onError: (error) => console.error("xiangqi match error", error),
      },
    );
    runner.start();
    setSession({ runner, local });
    return () => {
      runner.dispose();
      setSession(null);
    };
    // The keyed XiangqiMatch instance owns one immutable mode configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      ? online?.localSeat ?? 0
      : mode.kind === "ai"
        ? mode.localSeat
        : 0;
  const undoPlies =
    (mode.kind === "ai" || mode.kind === "online") && snapshot.activeSeat === localSeat
      ? 2
      : 1;
  const canUndo =
    snapshot.phase === "awaiting-move" &&
    state.moveCount >= undoPlies &&
    !online?.undoWaiting;
  const currentLegalMoves = useMemo(
    () => (activeIsLocal ? legalMoves(state) : []),
    [activeIsLocal, state],
  );

  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);

  useEffect(() => {
    if (!state.finished) {
      setShowResult(false);
      return;
    }
    const timer = setTimeout(() => setShowResult(true), 650);
    return () => clearTimeout(timer);
  }, [state.finished]);

  useEffect(() => {
    if (!state.finished || !state.resultReason || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: crypto.randomUUID(),
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
    // The result is recorded exactly once for this mounted match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  return (
    <>
      <div className="border-b border-border px-2 py-1 text-xs">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {state.finished ? (
            <Badge variant="secondary">
              {matchResultLabel(mode, snapshot.winnerSeat, online)}
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Trans>轮到 {sideName(mode, state.turnSeat, online)}</Trans>
            </Badge>
          )}
          <Badge variant="outline">
            <Plural value={{ moveNumber: state.moveCount + (state.finished ? 0 : 1) }} one="第 # 手" other="第 # 手" />
          </Badge>
          {state.inCheck ? (
            <Badge className="bg-[#b63a32] text-white"><Trans>将军</Trans></Badge>
          ) : null}
          {aiThinking ? <Badge variant="outline"><Trans>AI 思考中…</Trans></Badge> : null}
          {online && !state.finished && snapshot.phase === "awaiting-move" && snapshot.activeSeat !== online.localSeat ? (
            <Badge variant="outline"><Trans>等待对方落子…</Trans></Badge>
          ) : null}
          {online?.undoWaiting ? (
            <Badge variant="outline"><Trans>等待对方同意悔棋…</Trans></Badge>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            disabled={!canUndo}
            onClick={() => online ? online.onRequestUndo(undoPlies) : runner.undo(undoPlies)}
          >
            <Undo2 data-icon="inline-start" />
            <Trans>悔棋</Trans>
          </Button>
        </div>
      </div>
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden p-1.5">
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
      </div>
      {state.finished && showResult ? (
        <GameResultBar
          title={matchResultLabel(mode, snapshot.winnerSeat, online)}
          celebrate={
            snapshot.winnerSeat !== null &&
            (mode.kind === "hotseat" || snapshot.winnerSeat === localSeat)
          }
          details={
            <span>
              {resultReasonLabel(state.resultReason)} · <Plural value={{ moveCount: state.moveCount }} one="共 # 手" other="共 # 手" />
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
