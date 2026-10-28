import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { LightNoticeMessage } from "~/components/LightNotice";
import { useSettingsStore } from "~/store/settings";

import { GameResultBar } from "../engine/GameResultBar";
import { GameToolbar, GameToolbarAction } from "../engine/GameToolbar";
import { useGamesHistoryStore } from "../engine/history";
import { historyModeLabel } from "../engine/history-labels";
import { useMatchSnapshot } from "../engine/match";
import { useLocalGameSession } from "../engine/use-game-session";
import { playFinishSound, playStoneSound } from "./audio";
import { matchResultLabel, seatName } from "./labels";
import { ReversiStage } from "./ReversiStage";
import { countStones } from "./rules";
import { reversiSessions } from "./session";
import {
  REVERSI_GAME_ID,
  type ReversiHistoryPayload,
  type ReversiMode,
  type ReversiSession,
} from "./types";
import { matchUndoPlies } from "./undo";
import { useReversiPassNotice } from "./use-reversi-pass-notice";

interface OnlineViewProps {
  notice?: LightNoticeMessage | null;
  peerName: string;
  localSeat: number;
  undoWaiting: boolean;
  rematchWaiting: boolean;
  onRequestUndo(plies: number): void;
}

interface MatchProps {
  mode: ReversiMode;
  onRematch(): void;
  onExit(): void;
  onFinishedChange(finished: boolean): void;
}

export function ReversiMatch(props: MatchProps) {
  const volume = useSettingsStore((state) => state.gamesVolume);
  const session = useLocalGameSession(reversiSessions, ({ resolution }) => {
    playStoneSound(volume);
    if (resolution.state.finished) playFinishSound(volume);
  });
  if (!session) return <div className="flex-1" />;
  return <ReversiMatchView {...props} session={session} />;
}

export function ReversiMatchView({
  mode,
  session,
  onRematch,
  onExit,
  online,
  onFinishedChange,
}: MatchProps & { session: ReversiSession; online?: OnlineViewProps }) {
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const state = snapshot.state;
  const passNotice = useReversiPassNotice(runner.id, state);
  const addRecord = useGamesHistoryStore((store) => store.addRecord);
  const recorded = useRef(false);
  const activeKind =
    snapshot.activeSeat === null
      ? null
      : runner.controllers[snapshot.activeSeat]?.kind;
  const activeIsLocal =
    snapshot.phase === "awaiting-move" &&
    activeKind === "local" &&
    !online?.undoWaiting;
  const aiThinking = snapshot.phase === "awaiting-move" && activeKind === "ai";
  const localSeat =
    mode.kind === "online"
      ? (online?.localSeat ?? 0)
      : mode.kind === "ai"
        ? mode.localSeat
        : 0;
  const undoPlies = matchUndoPlies(
    runner,
    snapshot,
    mode.kind === "hotseat" ? undefined : localSeat,
  );
  const canUndo =
    snapshot.phase === "awaiting-move" && undoPlies > 0 && !online?.undoWaiting;
  const { black, white } = countStones(state.board);
  useEffect(() => {
    onFinishedChange(state.finished);
  }, [onFinishedChange, state.finished]);
  useEffect(() => {
    if (!state.finished || recorded.current) return;
    recorded.current = true;
    addRecord({
      id: runner.id,
      gameId: REVERSI_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: state.winnerSeat,
        moves: state.moveCount,
        localSeat: mode.kind === "hotseat" ? undefined : localSeat,
        black,
        white,
      } satisfies ReversiHistoryPayload,
    });
  }, [
    addRecord,
    runner.id,
    mode,
    state.finished,
    state.moveCount,
    state.winnerSeat,
    localSeat,
    black,
    white,
  ]);
  const { t } = useLingui();
  const currentPlayer = seatName(mode, state.turnSeat, online);
  return (
    <>
      <div className="app-scroll-safe-end flex min-h-0 flex-1 flex-col overflow-auto">
        <GameToolbar
          context={
            <>
              <span>
                {historyModeLabel({
                  mode: mode.kind,
                  difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
                })}
              </span>
              {mode.kind !== "hotseat" ? (
                <span>
                  {localSeat === 0 ? (
                    <Trans>你执黑</Trans>
                  ) : (
                    <Trans>你执白</Trans>
                  )}
                </span>
              ) : null}
            </>
          }
          actions={
            !state.finished ? (
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
            ) : null
          }
          status={
            state.finished ? (
              matchResultLabel(mode, state.winnerSeat, online)
            ) : online?.undoWaiting ? (
              <Trans>等待协商结果…</Trans>
            ) : aiThinking ? (
              <Trans>电脑思考中…</Trans>
            ) : online && activeKind === "remote" ? (
              <Trans>等待对方落子…</Trans>
            ) : (
              <Trans>轮到 {currentPlayer}</Trans>
            )
          }
          metrics={
            <>
              <span>
                <Trans comment="黑白棋当前棋子数量">
                  黑 {black} / 白 {white}
                </Trans>
              </span>
              <span>
                <Plural
                  value={{ moveCount: state.moveCount }}
                  one="# 手"
                  other="# 手"
                />
              </span>
            </>
          }
        />
        <ReversiStage
          state={state}
          notice={passNotice}
          onlineNotice={online?.notice ?? null}
          interactive={activeIsLocal}
          onPlay={(move) => local.submit(move)}
        />
      </div>
      {state.finished && (
        <GameResultBar
          title={matchResultLabel(mode, state.winnerSeat, online)}
          details={
            <Trans comment="黑白棋终局计分，黑白分别为棋子数量">
              黑 {black} : 白 {white}
            </Trans>
          }
          celebrate={
            state.winnerSeat !== null &&
            (mode.kind === "hotseat" || state.winnerSeat === localSeat)
          }
          rematchWaiting={online?.rematchWaiting}
          onRematch={onRematch}
          onExit={onExit}
        />
      )}
    </>
  );
}
