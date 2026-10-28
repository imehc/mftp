import "./sliding-puzzle.css";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeft,
  BookOpen,
  Check,
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
import { Spinner } from "~/components/ui/spinner";
import { BackLink } from "~/features/navigation/BackLink";
import { describeError } from "~/lib/errors";
import { useSettingsStore } from "~/store/settings";

import { formatGameTime } from "../engine/format-game-time";
import { GameActionsMenu } from "../engine/GameActionsMenu";
import { GameRestoreDialog } from "../engine/GameRestoreDialog";
import { GameSetupSelect } from "../engine/GameSetupSelect";
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
  const { t } = useLingui();
  const store = getPuzzleSession();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [audio] = useState(createPuzzleAudio);
  const [help, setHelp] = useState(false);
  const [history, setHistory] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const size = state.board.size;
  const blocked =
    help ||
    history ||
    menu ||
    confirm !== null ||
    state.status !== "ready" ||
    state.saved !== null ||
    state.busy;
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

      <div className="border-border flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <GameSetupSelect
          density="adaptive"
          wrapValue={false}
          label={<Trans comment="数字华容道棋盘的行数与列数">棋盘</Trans>}
          value={String(size)}
          onChange={(value) =>
            request({ kind: "new", size: Number(value) as PuzzleSize })
          }
          options={PUZZLE_SIZES.map((value) => ({
            value: String(value),
            label: `${value} × ${value}`,
          }))}
        />
        <div className="flex max-w-full flex-wrap items-center gap-1">
          <Button
            size="sm"
            disabled={blocked}
            onClick={() => request({ kind: "new", size })}
          >
            <Shuffle data-icon="inline-start" />
            <Trans comment="生成新的有解数字华容道棋盘">打乱</Trans>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t({
              message: "撤销移动",
              comment: "撤销数字华容道上一次滑块移动",
            })}
            disabled={disabled || state.data.cursor === 0}
            onClick={() => playSound(store.undo())}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t({
              message: "重做移动",
              comment: "恢复数字华容道刚撤销的移动",
            })}
            disabled={disabled || state.data.cursor === state.data.moves.length}
            onClick={() => playSound(store.redo())}
          >
            <Redo2 />
          </Button>
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs *:whitespace-nowrap">
          <span role="status" className="text-muted-foreground">
            {state.data.completed ? (
              <span className="text-success flex items-center gap-1">
                <Check className="size-3" />
                <Trans comment="数字华容道全部数字已排列完成">已完成</Trans>
              </span>
            ) : state.status === "loading" ? (
              <span className="flex items-center gap-1">
                <Spinner />
                <Trans>正在读取进度</Trans>
              </span>
            ) : state.data.started ? (
              <Trans comment="数字华容道正在进行的挑战">挑战中</Trans>
            ) : (
              <Trans>移动开始计时</Trans>
            )}
          </span>
          <span className="font-mono tabular-nums" aria-label={t`有效用时`}>
            {formatGameTime(state.data.elapsedMs)}
          </span>
          <span>
            <Plural
              value={state.data.offset + state.data.cursor}
              other="# 步"
            />
          </span>
          {state.data.assisted && (
            <span className="text-muted-foreground">
              <Trans>使用过撤销</Trans>
            </span>
          )}
          {state.data.completed && (
            <Button size="sm" onClick={() => execute({ kind: "new", size })}>
              <Trans>再来一局</Trans>
            </Button>
          )}
        </div>
      </div>

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
