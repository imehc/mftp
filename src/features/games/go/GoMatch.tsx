/**
 * Local match wiring (vs-AI / hotseat) and the shared match view used by
 * both local and online play: status bar, board stage, result overlay.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Flag, Undo2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useSettingsStore } from "~/store/settings";
import { AiController, LocalController } from "../engine/controllers";
import { useGamesHistoryStore } from "../engine/history";
import { MatchRunner, useMatchSnapshot } from "../engine/match";
import type { PlayerController, SeatIndex } from "../engine/types";
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

/** Extra view state when the match runs over the LAN room channel. */
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
}: {
  mode: GoMode;
  onRematch: () => void;
  onExit: () => void;
}) {
  const [session, setSession] = useState<GoSession | null>(null);
  const volume = useSettingsStore((s) => s.gamesVolume);

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
      // 执白后手: the AI takes seat 0 (black) and opens the game.
      controllers =
        mode.kind === "ai" && mode.localSeat === 1 ? [ai, local] : [local, ai];
    }
    const boardSize = mode.kind === "online" ? 19 : mode.boardSize;
    const runner = new MatchRunner(goGame, createInitialGoState(boardSize), controllers, {
      onMoveResolved: ({ resolution }) => {
        if (resolution.presentation.captured.length > 0) playCaptureSound(volume);
        else playStoneSound(volume);
        if (resolution.state.finished) playFinishSound(volume);
      },
      onError: (error) => console.error("go match error", error),
    });
    runner.start();
    setSession({ runner, local });
    return () => {
      runner.dispose();
      setSession(null);
    };
    // mode identity is stable per <GoMatch key=...> instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return <div className="flex-1" />;
  return (
    <GoMatchView
      mode={mode}
      session={session}
      onRematch={onRematch}
      onExit={onExit}
    />
  );
}

export function GoMatchView({
  mode,
  session,
  onRematch,
  onExit,
  online,
}: {
  mode: GoMode;
  session: GoSession;
  onRematch: () => void;
  onExit: () => void;
  online?: OnlineViewProps;
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
      ? online?.localSeat ?? 0
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
  const legalPoints = useMemo(() => {
    const points = Array<boolean>(state.board.length).fill(false);
    if (!activeIsLocal) return points;
    for (const move of legalPlays(state)) {
      if (move.kind === "play") {
        points[cellIndex(state.boardSize, move.row, move.col)] = true;
      }
    }
    return points;
  }, [activeIsLocal, state]);

  useEffect(() => {
    if (!state.finished) {
      setShowResult(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  const submitPass = () => local.submit({ kind: "pass" });

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
              <Trans>轮到</Trans> {seatName(mode, state.turnSeat, online)}
            </Badge>
          )}
          <Badge variant="outline">
            <Trans>第 {state.moveCount + (state.finished ? 0 : 1)} 手</Trans>
          </Badge>
          <Badge variant="outline">
            <Trans>提子 {state.captures[0]}:{state.captures[1]}</Trans>
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
      <div className="relative min-h-0 flex-1 p-1.5">
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
        {state.finished && showResult ? (
          <div className="absolute inset-0 z-20 flex animate-in items-center justify-center bg-black/35 p-4 backdrop-blur-[2px] fade-in duration-300">
            <div className="flex w-full max-w-[18rem] animate-in flex-col gap-3 rounded-lg border border-white/25 bg-background/95 p-4 text-foreground shadow-2xl fade-in zoom-in-95 duration-300">
              <div className="text-center">
                <div className="text-base font-semibold">
                  {matchResultLabel(mode, snapshot.winnerSeat, online)}
                </div>
                {state.finalScore ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {scoreLine(state)}
                  </div>
                ) : null}
                <div className="mt-1 text-xs text-muted-foreground">
                  <Trans>共 {state.moveCount} 手</Trans>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={online?.rematchWaiting}
                  onClick={onRematch}
                >
                  {online?.rematchWaiting ? (
                    <Trans>等待对方…</Trans>
                  ) : (
                    <Trans>再来一局</Trans>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={onExit}
                >
                  <Trans>返回选择</Trans>
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
