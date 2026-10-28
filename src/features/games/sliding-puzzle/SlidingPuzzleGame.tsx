import "./sliding-puzzle.css";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeft,
  BookOpen,
  History,
  Redo2,
  RotateCcw,
  Shuffle,
  Undo2,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Alert, AlertDescription } from "~/components/ui/alert";
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
import { BackLink } from "~/features/navigation/BackLink";
import { describeError } from "~/lib/errors";
import { useSettingsStore } from "~/store/settings";

import { formatGameTime } from "../engine/format-game-time";
import { GameActionsMenu } from "../engine/GameActionsMenu";
import {
  GameHeaderActionsProvider,
  GameHeaderActionsSlot,
} from "../engine/GameHeaderActions";
import { GameRestoreDialog } from "../engine/GameRestoreDialog";
import { GameSetupSelect } from "../engine/GameSetupSelect";
import { GameToolbar, GameToolbarAction } from "../engine/GameToolbar";
import { useGameAudio } from "../engine/use-game-audio";
import { createPuzzleAudio } from "./audio";
import { getPuzzleSession } from "./session";
import { SlidingPuzzleBoard } from "./SlidingPuzzleBoard";
import {
  SlidingPuzzleHelp,
  SlidingPuzzleHistory,
} from "./SlidingPuzzleDialogs";
import { PUZZLE_SIZES, type PuzzleSize } from "./types";

type Confirmation =
  { kind: "new"; size: PuzzleSize } | { kind: "restart" | "discard" };

export default function SlidingPuzzleGame() {
  return (
    <GameHeaderActionsProvider>
      <SlidingPuzzleGameContent />
    </GameHeaderActionsProvider>
  );
}

function SlidingPuzzleGameContent() {
  const { t } = useLingui();
  const store = getPuzzleSession();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [audio] = useState(createPuzzleAudio);
  const [help, setHelp] = useState(false);
  const [history, setHistory] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const size = state.board.size;
  const actionBlocked =
    help ||
    history ||
    confirm !== null ||
    state.status !== "ready" ||
    state.saved !== null ||
    state.busy;
  const blocked = actionBlocked || menu;
  const disabled = blocked || state.data.completed;
  useGameAudio(audio);

  useEffect(() => {
    void store.load();
    return store.attach();
  }, [store]);
  useEffect(() => {
    store.setEnabled(!blocked);
  }, [store, blocked]);

  const execute = (action: Confirmation) => {
    if (action.kind === "discard") void store.discard();
    else if (action.kind === "restart") store.restart();
    else if (action.kind === "new") store.newGame(action.size);
  };

  const request = (action: Confirmation) => {
    if (state.status !== "ready" || state.saved || state.busy) return;
    if (state.data.started) setConfirm(action);
    else execute(action);
  };

  const playSound = (moved: boolean) => {
    if (moved) audio.play(useSettingsStore.getState().gamesVolume);
  };

  const unlock = () => {
    if (useSettingsStore.getState().gamesVolume > 0) audio.unlock();
  };

  return (
    <main
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      onPointerDownCapture={unlock}
      onKeyDownCapture={unlock}
    >
      <ToolPageHeader
        variant="compact"
        showHome={false}
        showActivity={false}
        title={
          <Trans comment="小游戏名，滑动数字方块填入空位并排序">
            数字华容道
          </Trans>
        }
        leading={
          <Button variant="ghost" size="icon-sm" asChild>
            <BackLink
              to="/"
              search={{ category: "games" }}
              aria-label={t`返回小游戏`}
            >
              <ArrowLeft />
            </BackLink>
          </Button>
        }
        trailing={
          <>
            <GameHeaderActionsSlot />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`玩法与操作`}
              onClick={() => setHelp(true)}
            >
              <BookOpen />
            </Button>
            <GameActionsMenu
              showMatchActions={false}
              matchFinished={state.data.completed}
              canRestart={false}
              onRestart={() => {}}
              onExit={() => {}}
              onOpenChange={setMenu}
              extraActions={(closeThen) => (
                <>
                  <GameSetupSelect
                    density="adaptive"
                    wrapValue={false}
                    label={
                      <Trans comment="数字华容道棋盘的行数与列数">棋盘</Trans>
                    }
                    value={String(size)}
                    onChange={(value) =>
                      closeThen(() =>
                        request({
                          kind: "new",
                          size: Number(value) as PuzzleSize,
                        }),
                      )
                    }
                    options={PUZZLE_SIZES.map((value) => ({
                      value: String(value),
                      label: `${value} × ${value}`,
                    }))}
                  />

                  <Button
                    variant="ghost"
                    density="adaptive"
                    className="w-full justify-start"
                    disabled={
                      state.status !== "ready" || !!state.saved || state.busy
                    }
                    onClick={() =>
                      closeThen(() => request({ kind: "restart" }))
                    }
                  >
                    <RotateCcw data-icon="inline-start" />
                    <Trans comment="恢复数字华容道本局最初排列并清零计时计步">
                      重新开始本局
                    </Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    density="adaptive"
                    className="w-full justify-start"
                    onClick={() => closeThen(() => setHistory(true))}
                  >
                    <History data-icon="inline-start" />
                    <Trans comment="查看数字华容道完成成绩">成绩记录</Trans>
                  </Button>
                </>
              )}
            />
          </>
        }
      />

      <GameToolbar
        context={
          <span>
            {size} × {size}
          </span>
        }
        actions={
          <>
            <GameToolbarAction
              icon={Undo2}
              label={t`撤销移动`}
              disabled={
                actionBlocked || state.data.completed || state.data.cursor === 0
              }
              onClick={() => playSound(store.undo())}
            />
            <GameToolbarAction
              secondary
              icon={Redo2}
              label={t`重做移动`}
              disabled={
                actionBlocked ||
                state.data.completed ||
                state.data.cursor === state.data.moves.length
              }
              onClick={() => playSound(store.redo())}
            />
            <GameToolbarAction
              secondary
              icon={Shuffle}
              label={
                state.data.completed
                  ? t`再来一局`
                  : t({
                      message: "打乱",
                      comment: "生成新的有解数字华容道棋盘",
                    })
              }
              disabled={actionBlocked}
              onClick={() => request({ kind: "new", size })}
            />
          </>
        }
        status={
          state.data.completed ? (
            <span className="text-success">
              <Trans comment="数字华容道全部数字已排列完成">已完成</Trans>
            </span>
          ) : state.status === "loading" ? (
            <Trans>正在读取进度</Trans>
          ) : state.data.started ? (
            <Trans comment="数字华容道正在进行的挑战">挑战中</Trans>
          ) : (
            <Trans>移动开始计时</Trans>
          )
        }
        metrics={
          <>
            <span className="font-mono" aria-label={t`有效用时`}>
              {formatGameTime(state.data.elapsedMs)}
            </span>
            <span>
              <Plural
                value={state.data.offset + state.data.cursor}
                other="# 步"
              />
            </span>
          </>
        }
        details={state.data.assisted ? <Trans>使用过撤销</Trans> : null}
      />

      {state.saved && (
        <GameRestoreDialog
          description={<Trans>发现上次的数字华容道进度，是否继续？</Trans>}
          busy={state.busy}
          error={state.error ? describeError(state.error, t) : undefined}
          onRestore={store.restore}
          onDiscard={() => void store.discard()}
        />
      )}

      {state.error && !state.saved && (
        <div className="shrink-0 p-3">
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-2">
              <span>{describeError(state.error, t)}</span>
              <div className="flex flex-wrap gap-2">
                {state.error && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={state.busy}
                    onClick={() => {
                      if (state.error?.code === "games:checkpoint_delete")
                        void store.discard();
                      else if (state.status === "error") void store.load();
                      else store.save();
                    }}
                  >
                    <Trans>重试</Trans>
                  </Button>
                )}
                {state.status === "error" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={state.busy}
                    onClick={() => setConfirm({ kind: "discard" })}
                  >
                    <Trans>丢弃存档</Trans>
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="sliding-puzzle-workspace app-scroll-safe-end">
        <SlidingPuzzleBoard
          key={state.data.id}
          board={state.board}
          disabled={disabled}
          onMove={(tile) => playSound(store.move(tile))}
        />
      </div>

      <SlidingPuzzleHelp open={help} onOpenChange={setHelp} size={size} />
      <SlidingPuzzleHistory open={history} onOpenChange={setHistory} />
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "discard" ? (
                <Trans>丢弃数字华容道存档？</Trans>
              ) : confirm?.kind === "restart" ? (
                <Trans>重新开始本局？</Trans>
              ) : (
                <Trans>开始新的数字华容道？</Trans>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "restart" ? (
                <Trans>
                  恢复本局最初的打乱排列，用时与步数清零，当前移动记录无法恢复。
                </Trans>
              ) : (
                <Trans>当前棋盘进度和移动记录将被替换，无法恢复。</Trans>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action) execute(action);
              }}
            >
              <Trans>确认</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
