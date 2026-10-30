import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Chess, type Square } from "chess.js";
import { Handshake, RotateCw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LightNoticeMessage } from "~/components/LightNotice";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { useSettingsStore } from "~/store/settings";

import { GameSelect } from "../engine/BoardModeMenu";
import { GameResultBar } from "../engine/GameResultBar";
import {
  GameMenuActionButton,
  GameToolbar,
  GameToolbarAction,
} from "../engine/GameToolbar";
import { useGamesHistoryStore } from "../engine/history";
import { historyModeLabel } from "../engine/history-labels";
import { useMatchSnapshot } from "../engine/match";
import { useBoardAccentColor } from "../engine/use-board-accent";
import { useLocalGameSession } from "../engine/use-game-session";
import { playChessMove } from "./audio";
import { DrawClaimDialog, PromotionDialog } from "./ChessDialogs";
import { ChessStage } from "./ChessStage";
import { chessResultLabel, pieceNames, resultNames, sideName } from "./labels";
import { applyChessMove, claimReason, legalTurns, seatFor } from "./rules";
import { chessSessions } from "./session";
import {
  CHESS_GAME_ID,
  type ChessHistoryPayload,
  type ChessMode,
  type ChessMove,
  type ChessSession,
  type ChessTurn,
  type ChessView,
  type Promotion,
} from "./types";
import { chessUndoPlies } from "./undo";

interface OnlineViewProps {
  notice?: LightNoticeMessage | null;
  peerName: string;
  localSeat: number;
  undoWaiting: boolean;
  rematchWaiting: boolean;
  onRequestUndo(plies: number): void;
}

interface MatchProps {
  mode: ChessMode;
  onRematch(): void;
  onExit(): void;
  onFinishedChange(finished: boolean): void;
}

export function ChessMatch(props: MatchProps) {
  const volume = useSettingsStore((state) => state.gamesVolume);
  const session = useLocalGameSession(chessSessions, ({ resolution }) =>
    playChessMove(volume, !!resolution.state.result),
  );
  if (!session) return <div className="flex-1" />;
  return <ChessMatchView {...props} session={session} />;
}

export function ChessMatchView({
  mode,
  session,
  onRematch,
  onExit,
  onFinishedChange,
  online,
}: MatchProps & { session: ChessSession; online?: OnlineViewProps }) {
  const { t } = useLingui();
  const { runner, local } = session,
    snapshot = useMatchSnapshot(runner),
    state = snapshot.state;
  const chess = new Chess(state.fen),
    seat = seatFor(chess.turn()),
    finished = state.result !== null;
  const localSeat =
    mode.kind === "ai" ? mode.localSeat : (online?.localSeat ?? 0);
  const [selection, setSelection] = useState<{
    fen: string;
    square: Square;
  } | null>(null);
  const selected = selection?.fen === state.fen ? selection.square : null;
  const [pending, setPending] = useState<{
    fen: string;
    from: Square;
    to: Square;
  } | null>(null);
  const [draw, setDraw] = useState<{ fen: string; move: ChessTurn } | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [optionsOpen, setOptionsOpen] = useState(false);
  const [view, setView] = useState<ChessView>("top"),
    [reversed, setReversed] = useState(false);
  const accent = useBoardAccentColor();
  const [showNames, setShowNames] = useState(true);
  const names = {
    k: t(pieceNames.k),
    q: t(pieceNames.q),
    r: t(pieceNames.r),
    b: t(pieceNames.b),
    n: t(pieceNames.n),
    p: t(pieceNames.p),
  };
  const kind =
    snapshot.activeSeat === null
      ? null
      : runner.controllers[snapshot.activeSeat]?.kind;
  const active =
    snapshot.phase === "awaiting-move" &&
    kind === "local" &&
    !online?.undoWaiting;
  const interactive =
    active &&
    !busy &&
    pending?.fen !== state.fen &&
    draw?.fen !== state.fen &&
    !optionsOpen;
  const undoPlies = chessUndoPlies(
    runner,
    snapshot,
    mode.kind === "hotseat" ? undefined : localSeat,
  );
  const addRecord = useGamesHistoryStore((store) => store.addRecord),
    recorded = useRef(false);
  useEffect(() => onFinishedChange(finished), [onFinishedChange, finished]);
  useEffect(() => {
    if (!state.result || recorded.current) return;
    recorded.current = true;
    addRecord({
      id: runner.id,
      gameId: CHESS_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat: state.winnerSeat,
        result: state.result,
        moves: state.ply,
        localSeat: mode.kind === "hotseat" ? undefined : localSeat,
      } satisfies ChessHistoryPayload,
    });
  }, [
    addRecord,
    runner.id,
    mode,
    state.result,
    state.winnerSeat,
    state.ply,
    localSeat,
  ]);
  const legal = legalTurns(state, selected ?? undefined);
  const targets = selected
    ? Array.from(new Set(legal.map((move) => move.to)))
    : [];
  const result = chessResultLabel(mode, state.winnerSeat, localSeat);
  const player =
    mode.kind === "hotseat" ? (
      sideName(seat)
    ) : seat === localSeat ? (
      <Trans>你</Trans>
    ) : mode.kind === "ai" ? (
      <Trans>电脑</Trans>
    ) : (
      online?.peerName || <Trans>对方</Trans>
    );

  function submit(move: ChessMove) {
    if (runner.getSnapshot() !== snapshot || !active || !local.awaitingInput)
      return;
    local.submit(move);
    setSelection(null);
    setPending(null);
    setDraw(null);
  }

  function complete(turn: ChessTurn) {
    // 预声明和棋在提交前选择；不先落子再回滚，联机只传递一个原子动作。
    const next = applyChessMove(state, { type: "move", ...turn }, seat).state;
    if (!next.result && claimReason(state, turn)) {
      setPending(null);
      setDraw({ fen: state.fen, move: turn });
    } else submit({ type: "move", ...turn });
  }

  function attempt(from: Square, to: Square) {
    if (!interactive) return;
    const candidates = legalTurns(state, from).filter((move) => move.to === to);
    if (!candidates.length) return;
    if (candidates.some((move) => move.promotion))
      setPending({ fen: state.fen, from, to });
    else complete(candidates[0]);
  }

  function select(square: Square) {
    if (!interactive) return;
    if (selected && targets.includes(square)) {
      attempt(selected, square);
      return;
    }
    const piece = chess.get(square);
    setSelection(
      piece?.color === chess.turn() && selected !== square
        ? { fen: state.fen, square }
        : null,
    );
  }

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
              {mode.kind !== "hotseat" && (
                <span>
                  {localSeat === 0 ? (
                    <Trans>你执白</Trans>
                  ) : (
                    <Trans>你执黑</Trans>
                  )}
                </span>
              )}
            </>
          }
          actions={
            !finished ? (
              <>
                <GameToolbarAction
                  icon={Undo2}
                  label={t`悔棋`}
                  disabled={busy || undoPlies === 0 || !!online?.undoWaiting}
                  onClick={() => {
                    setSelection(null);
                    setPending(null);
                    setDraw(null);
                    if (online) online.onRequestUndo(undoPlies);
                    else runner.undo(undoPlies);
                  }}
                />
                {claimReason(state) && (
                  <GameToolbarAction
                    secondary
                    icon={Handshake}
                    label={t`申领和棋`}
                    disabled={!active || busy}
                    onClick={() => submit({ type: "claim" })}
                  />
                )}
              </>
            ) : null
          }
          status={
            finished ? (
              result
            ) : online?.undoWaiting ? (
              <Trans>等待协商结果…</Trans>
            ) : kind === "ai" ? (
              <Trans>电脑思考中…</Trans>
            ) : (
              <>
                {chess.isCheck() ? (
                  <Trans>将军 · 轮到 {player}</Trans>
                ) : (
                  <Trans>轮到 {player}</Trans>
                )}
              </>
            )
          }
          metrics={
            <span>
              <Plural value={{ ply: state.ply }} one="# 手" other="# 手" />
            </span>
          }
          details={
            state.result ? (
              <span>{t(resultNames[state.result])}</span>
            ) : undefined
          }
          parameters={
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="chess-piece-names">
                  <Trans>显示棋子名称</Trans>
                </Label>
                <Switch
                  id="chess-piece-names"
                  checked={showNames}
                  onCheckedChange={setShowNames}
                />
              </div>
              <GameSelect
                label={<Trans>棋盘视角</Trans>}
                value={view}
                onChange={(value) => setView(value as ChessView)}
                options={[
                  { value: "table", label: t`立体视角` },
                  { value: "top", label: t`正上方俯视` },
                ]}
              />
            </div>
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
          onInfoOpenChange={setOptionsOpen}
        />
        <ChessStage
          state={state}
          selected={selected}
          targets={targets}
          focus={null}
          view={view}
          flipped={(mode.kind !== "hotseat" && localSeat === 1) !== reversed}
          accent={accent}
          labels={showNames ? names : null}
          interactive={interactive}
          onSquare={select}
          onDrop={attempt}
          onBusy={setBusy}
          notice={online?.notice}
        />
      </div>
      <PromotionDialog
        open={pending?.fen === state.fen && active}
        onClose={() => setPending(null)}
        onChoose={(promotion: Promotion) => {
          if (pending?.fen === state.fen)
            complete({ from: pending.from, to: pending.to, promotion });
        }}
      />
      <DrawClaimDialog
        move={draw?.fen === state.fen && active ? draw.move : null}
        onClose={() => setDraw(null)}
        onPlay={() => {
          if (draw?.fen === state.fen) submit({ type: "move", ...draw.move });
        }}
        onClaim={() => {
          if (draw?.fen === state.fen)
            submit({ type: "claim", intended: draw.move });
        }}
      />
      {finished && (
        <GameResultBar
          title={result}
          details={state.result ? t(resultNames[state.result]) : undefined}
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
