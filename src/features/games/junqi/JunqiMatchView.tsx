import { Trans, useLingui } from "@lingui/react/macro";
import { FlagIcon, RotateCw, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameResultBar } from "../engine/GameResultBar";
import { useGamesHistoryStore } from "../engine/history";
import { canSwap } from "./deployment";
import { JunqiRulesDialog } from "./JunqiRulesDialog";
import { JunqiToolbar } from "./JunqiToolbar";
import { JunqiUndoDialog } from "./JunqiUndoDialog";
import { REASON_LABELS, ResultLabel } from "./labels";
import type { JunqiIntent } from "./online-protocol";
import { JunqiStage } from "./render/JunqiStage";
import {
  JUNQI_GAME_ID,
  type JunqiHistoryPayload,
  type JunqiMode,
  type Side,
} from "./types";
import type { JunqiView } from "./view-types";
import { viewDestinations } from "./visibility";

export function JunqiMatchView({
  mode,
  onRestart,
  onExit,
  view,
  localSeat,
  interactive,
  onAction,
  recordId,
  notice,
  peerName,
  rematchWaiting = false,
  canRecord = true,
  undo,
}: {
  mode: JunqiMode;
  view: JunqiView;
  localSeat: Side;
  interactive: boolean;
  onAction(action: JunqiIntent): void;
  onRestart(): void;
  onExit(): void;
  recordId: string;
  notice?: ReactNode;
  peerName?: string;
  rematchWaiting?: boolean;
  canRecord?: boolean;
  undo?: { enabled: boolean; waiting: boolean; request(): void };
}) {
  const { t } = useLingui();
  const [selection, setSelection] = useState<{
    revision: number;
    index: number;
  } | null>(null);
  const [flipped, setFlipped] = useState(localSeat === 1);
  const [confirmConcede, setConfirmConcede] = useState(false);
  const [confirmArrange, setConfirmArrange] = useState(false);
  const [undoRevision, setUndoRevision] = useState<number | null>(null);
  const addRecord = useGamesHistoryStore((store) => store.addRecord);
  const finished = view.phase === "finished",
    deployment = view.phase === "deployment";
  const deploymentBoard = view.board.map((piece) =>
    piece?.face === "known" ? piece : null,
  );
  const selected =
    selection?.revision === view.revision ? selection.index : null;
  const targets =
    selected === null || !interactive
      ? []
      : deployment
        ? view.board.flatMap((_, index) =>
            canSwap(deploymentBoard, selected, index, localSeat) ? [index] : [],
          )
        : viewDestinations(view, selected);
  useEffect(() => {
    if (!finished || !view.reason || !canRecord) return;
    addRecord({
      id: recordId,
      gameId: JUNQI_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        mode: mode.kind,
        winner: view.winner,
        variant: view.variant,
        localSide: view.viewerSide,
        reason: view.reason,
        moves: view.ply,
      } satisfies JunqiHistoryPayload,
    });
  }, [
    addRecord,
    canRecord,
    finished,
    mode.kind,
    recordId,
    view.ply,
    view.reason,
    view.winner,
    view.variant,
    view.viewerSide,
  ]);

  function submit(move: JunqiIntent) {
    if (!interactive) return;
    onAction(move);
    setSelection(null);
  }

  const selectable = interactive
    ? view.board.flatMap((piece, index) =>
        (view.variant === "flip" && piece?.face === "covered") ||
        (piece?.face === "known" &&
          piece.side === view.turnSide &&
          (deployment || viewDestinations(view, index).length > 0))
          ? [index]
          : [],
      )
    : [];

  function selectCell(index: number) {
    if (view.variant === "flip" && view.board[index]?.face === "covered") {
      submit({ type: "flip", at: index });
      return;
    }
    if (selected !== null && targets.includes(index)) {
      submit({ type: deployment ? "swap" : "move", from: selected, to: index });
    } else
      setSelection(
        index !== selected && selectable.includes(index)
          ? { revision: view.revision, index }
          : null,
      );
  }

  return (
    <>
      <BoardGameHeader
        title={<Trans>陆战棋</Trans>}
        active
        finished={finished}
        canRestart={mode.kind === "ai"}
        onRestart={onRestart}
        onExit={onExit}
        help={
          <JunqiRulesDialog
            variant={mode.variant}
            online={mode.kind === "online"}
          />
        }
        extraActions={(closeThen) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => closeThen(() => setFlipped((value) => !value))}
            >
              <RotateCw data-icon="inline-start" />
              <Trans>翻转棋盘</Trans>
            </Button>
            {undo && !deployment && !finished ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={!undo.enabled}
                title={
                  !undo.enabled
                    ? t`需先完成自己的一手棋，并等待当前同步或协商结束。`
                    : undefined
                }
                onClick={() =>
                  closeThen(() =>
                    view.variant === "open"
                      ? undo.request()
                      : setUndoRevision(view.revision),
                  )
                }
              >
                <Undo2 data-icon="inline-start" />
                <Trans comment="联机棋局的操作按钮，向对方申请撤销最近的走棋">
                  悔棋
                </Trans>
              </Button>
            ) : null}
            {!deployment && !finished && view.turnSide !== null ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={!interactive}
                title={!interactive ? t`轮到你时可以认输` : undefined}
                onClick={() => closeThen(() => setConfirmConcede(true))}
              >
                <FlagIcon data-icon="inline-start" />
                <Trans>认输</Trans>
              </Button>
            ) : null}
          </>
        )}
      />
      {notice}
      <JunqiToolbar
        mode={mode}
        state={view}
        localSeat={localSeat}
        peerName={peerName}
        undoWaiting={undo?.waiting}
        interactive={interactive}
        onArrange={() => setConfirmArrange(true)}
        onReady={() => submit({ type: "ready" })}
      />
      <JunqiStage
        board={view.board}
        flipped={flipped}
        interactive={interactive}
        deployment={deployment}
        selectable={selectable}
        selected={selected}
        targets={targets}
        lastMove={view.lastMove}
        onCell={selectCell}
        onCancel={() => setSelection(null)}
      />
      {finished ? (
        <GameResultBar
          title={
            <ResultLabel
              winner={view.winner}
              localSide={view.viewerSide}
              online={mode.kind === "online"}
            />
          }
          details={view.reason ? t(REASON_LABELS[view.reason]) : null}
          celebrate={view.winner !== null && view.winner === view.viewerSide}
          rematchWaiting={rematchWaiting}
          onRematch={onRestart}
          onExit={onExit}
        />
      ) : null}
      <AlertDialog open={confirmConcede} onOpenChange={setConfirmConcede}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>认输本局？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>认输后对方获胜，本局将结束。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!interactive || finished}
              onClick={() => submit({ type: "concede" })}
            >
              <Trans>认输</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {undo ? (
        <JunqiUndoDialog
          view={view}
          localSeat={localSeat}
          open={undo.enabled && undoRevision === view.revision}
          onOpenChange={(open) => {
            if (!open) setUndoRevision(null);
          }}
          onRequest={undo.request}
        />
      ) : null}
      <AlertDialog open={confirmArrange} onOpenChange={setConfirmArrange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>重新随机布阵？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>将替换当前己方阵型，对方阵型保持不变。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!interactive || !deployment}
              onClick={() =>
                submit({
                  type: "arrange",
                })
              }
            >
              <Trans>随机布阵</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
