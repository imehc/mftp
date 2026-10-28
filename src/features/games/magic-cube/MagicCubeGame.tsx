import "./magic-cube.css";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Eye,
  History,
  Redo2,
  RotateCcw,
  Scan,
  Shuffle,
  SlidersHorizontal,
  Tags,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Spinner } from "~/components/ui/spinner";
import { BackLink } from "~/features/navigation/BackLink";
import { describeError, frontendError } from "~/lib/errors";
import { useMediaQuery } from "~/lib/use-media-query";
import { useSettingsStore } from "~/store/settings";

import { formatGameTime } from "../engine/format-game-time";
import { GameActionsMenu } from "../engine/GameActionsMenu";
import { GameRestoreDialog } from "../engine/GameRestoreDialog";
import { GameSetupSelect } from "../engine/GameSetupSelect";
import { useGameAudio } from "../engine/use-game-audio";
import { createCubeAudio } from "./audio";
import { faceMove } from "./engine";
import { MagicCubeControls } from "./MagicCubeControls";
import { MagicCubeHelp, MagicCubeHistory } from "./MagicCubeDialogs";
import { type CubeStageHandle, MagicCubeStage } from "./render/MagicCubeStage";
import { getCubeSession } from "./session";
import { type CubeOrder, type Face, ORDERS } from "./types";

type Confirmation =
  | { kind: "reset" | "scramble" | "order"; order: CubeOrder }
  | { kind: "discard" };

export default function MagicCubeGame() {
  const { t } = useLingui();
  const store = getCubeSession();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [audio] = useState(createCubeAudio);
  const stage = useRef<CubeStageHandle>(null);
  const [ready, setReady] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [help, setHelp] = useState(false);
  const [history, setHistory] = useState(false);
  const [controls, setControls] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [observe, setObserve] = useState(false);
  const [labels, setLabels] = useState(false);
  const [face, setFace] = useState<Face>("R");
  const [depth, setDepth] = useState(1);
  const [interacting, setInteracting] = useState(false);
  const short = useMediaQuery("(max-height: 32rem)");
  const wide = useMediaQuery("(min-width: 64rem)");
  const order = state.cube.order;
  const selectedDepth = Math.min(depth, order);
  const blocked =
    help ||
    history ||
    menu ||
    confirm !== null ||
    !ready ||
    renderError ||
    state.status !== "ready" ||
    state.saved !== null;
  const disabled = blocked || state.busy || state.data.completed;
  useGameAudio(audio);

  useEffect(() => {
    void store.load();
    return store.attach(async (move) => {
      audio.play(useSettingsStore.getState().gamesVolume);
      await stage.current?.play(move);
    });
  }, [store, audio]);

  useEffect(() => {
    store.setEnabled(!blocked);
  }, [store, blocked]);

  const execute = (action: Confirmation) => {
    if (action.kind === "discard") {
      void store.discard();
      return;
    }
    setReady(false);
    setDepth(1);
    setRenderError(false);
    store.newCube(action.order, action.kind === "scramble");
  };

  const requestNew = (action: Confirmation) => {
    if (state.status !== "ready" || state.saved) return;
    if (state.data.started || state.data.challenge) setConfirm(action);
    else execute(action);
  };

  const precision = (
    <MagicCubeControls
      order={order}
      face={face}
      depth={selectedDepth}
      onFace={setFace}
      onDepth={setDepth}
      onTurn={store.turn}
      disabled={disabled}
    />
  );
  const selection =
    controls || (wide && !short)
      ? faceMove(face, selectedDepth, true, order)
      : null;

  const retryRender = () => {
    setRenderError(false);
    setReady(false);
    setRetry((value) => value + 1);
  };

  const unlock = () => {
    if (useSettingsStore.getState().gamesVolume > 0) audio.unlock();
  };

  return (
    <div
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
      onPointerDownCapture={unlock}
      onKeyDownCapture={unlock}
    >
      <ToolPageHeader
        variant="compact"
        showHome={false}
        showActivity={false}
        title={
          <Trans comment="小游戏名称，指可转动的多阶立方体谜题">魔方</Trans>
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
                    disabled={state.status !== "ready" || !!state.saved}
                    onClick={() =>
                      closeThen(() => requestNew({ kind: "reset", order }))
                    }
                  >
                    <RotateCcw data-icon="inline-start" />
                    <Trans>重置魔方</Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    density="adaptive"
                    className="w-full justify-start"
                    onClick={() =>
                      closeThen(() => stage.current?.resetCamera())
                    }
                  >
                    <Scan data-icon="inline-start" />
                    <Trans>重置视角</Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    density="adaptive"
                    className="w-full justify-start"
                    aria-pressed={labels}
                    onClick={() => setLabels(!labels)}
                  >
                    <Tags data-icon="inline-start" />
                    {labels ? (
                      <Trans>隐藏面标识</Trans>
                    ) : (
                      <Trans>显示面标识</Trans>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    density="adaptive"
                    className="w-full justify-start"
                    onClick={() => closeThen(() => setHistory(true))}
                  >
                    <History data-icon="inline-start" />
                    <Trans>挑战记录</Trans>
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
          label={
            <Trans comment="魔方每条边的小块数量，例如二阶、三阶">阶数</Trans>
          }
          value={String(order)}
          onChange={(value) =>
            requestNew({ kind: "order", order: Number(value) as CubeOrder })
          }
          options={ORDERS.map((value) => ({
            value: String(value),
            label: t({
              message: `${value} 阶`,
              comment: "魔方阶数，value 为每边小块数量",
            }),
          }))}
        />
        <div className="flex max-w-full flex-wrap items-center gap-1">
          <Button
            size="sm"
            disabled={blocked || state.busy}
            onClick={() => requestNew({ kind: "scramble", order })}
          >
            <Shuffle data-icon="inline-start" />
            <Trans comment="用合法转动打乱魔方并开始新挑战">打乱</Trans>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={disabled || state.data.cursor === 0}
            aria-label={t({
              message: "撤销转动",
              comment: "撤销上一步魔方转层操作",
            })}
            onClick={store.undo}
          >
            <Undo2 />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={disabled || state.data.cursor === state.data.moves.length}
            aria-label={t({
              message: "重做转动",
              comment: "恢复刚才撤销的魔方转层操作",
            })}
            onClick={store.redo}
          >
            <Redo2 />
          </Button>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={observe}
            onClick={() => setObserve(!observe)}
          >
            <Eye data-icon="inline-start" />
            <Trans>观察模式</Trans>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="magic-cube-controls-trigger"
            onClick={() => setControls(true)}
          >
            <SlidersHorizontal data-icon="inline-start" />
            <Trans>精确转动</Trans>
          </Button>
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs *:whitespace-nowrap">
          <span className="text-muted-foreground" role="status">
            {state.data.completed ? (
              <span className="text-success flex items-center gap-1">
                <Check className="size-3" />
                <Trans>已还原</Trans>
              </span>
            ) : state.data.challenge ? (
              state.data.started ? (
                <Trans>挑战中</Trans>
              ) : (
                <Trans>转动开始计时</Trans>
              )
            ) : (
              <Trans comment="魔方未开始计时挑战，可自由操作">自由练习</Trans>
            )}
          </span>
          <span className="font-mono tabular-nums" aria-label={t`有效用时`}>
            {formatGameTime(state.elapsedMs)}
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
          <Button
            className="magic-cube-scroll-toggle"
            size="sm"
            variant="outline"
            aria-pressed={interacting}
            onClick={() => setInteracting(!interacting)}
          >
            {interacting ? (
              <Trans>退出画布操作</Trans>
            ) : (
              <Trans>操作魔方</Trans>
            )}
          </Button>
        </div>
      </div>

      {state.saved && (
        <GameRestoreDialog
          description={<Trans>发现上次的魔方进度，是否继续？</Trans>}
          busy={state.busy}
          error={state.error ? describeError(state.error, t) : undefined}
          onRestore={() => {
            setReady(false);
            store.restore();
          }}
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

      <div
        className="magic-cube-workspace app-scroll-safe-end"
        data-interacting={interacting}
      >
        <div className="magic-cube-stage">
          {!renderError && (
            <MagicCubeStage
              key={`${state.data.id}-${retry}`}
              ref={stage}
              cube={state.cube}
              busy={state.busy}
              enabled={!blocked && !controls && (!short || interacting)}
              observe={observe || state.data.completed}
              labels={labels || controls}
              selection={selection}
              onTurn={store.turn}
              onReady={() => setReady(true)}
              onError={() => setRenderError(true)}
            />
          )}
          {(!ready || state.status === "loading") && !renderError && (
            <div
              role="status"
              className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm"
            >
              <Spinner />
              <Trans>正在准备魔方…</Trans>
            </div>
          )}
          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <Alert variant="destructive" className="max-w-sm">
                <AlertDescription className="flex flex-col gap-3">
                  <span>
                    {describeError(
                      frontendError(
                        "magic-cube:render",
                        "Cube WebGL rendering unavailable",
                      ),
                      t,
                    )}
                  </span>
                  <Button variant="outline" onClick={retryRender}>
                    <Trans>重新加载画布</Trans>
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>
        <aside className="magic-cube-side app-scroll-safe-end">
          <h2 className="text-sm font-medium">
            <Trans>精确转动</Trans>
          </h2>
          {precision}
        </aside>
      </div>

      <Dialog open={controls} onOpenChange={setControls}>
        <DialogLayoutContent placement="responsive-sheet">
          <DialogLayoutHeader>
            <DialogTitle>
              <Trans>精确转动</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>选择面和层，再转动选中层。</Trans>
            </DialogDescription>
          </DialogLayoutHeader>
          <DialogLayoutBody>{precision}</DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
      <MagicCubeHelp open={help} onOpenChange={setHelp} />
      <MagicCubeHistory open={history} onOpenChange={setHistory} />
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
                <Trans>丢弃魔方存档？</Trans>
              ) : confirm?.kind === "order" ? (
                <Trans>切换魔方阶数？</Trans>
              ) : confirm?.kind === "scramble" ? (
                <Trans>重新打乱魔方？</Trans>
              ) : (
                <Trans>重置魔方？</Trans>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>当前魔方进度和撤销记录将被替换，无法恢复。</Trans>
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
    </div>
  );
}
