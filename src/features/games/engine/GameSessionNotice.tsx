import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState, useSyncExternalStore } from "react";

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
import { describeError } from "~/lib/errors";

import type { GameSessionStore } from "./game-session-store";
import { GameRestoreDialog } from "./GameRestoreDialog";

export function GameSessionNotice<Mode, State, Move, Presentation>({
  store,
  onRestore,
  restoreDescription,
}: {
  store: GameSessionStore<Mode, State, Move, Presentation>;
  onRestore?: () => void;
  restoreDescription?: ReactNode;
}) {
  const { t } = useLingui();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [discardOpen, setDiscardOpen] = useState(false);
  if (state.status === "loading")
    return (
      <div
        role="status"
        className="text-muted-foreground flex items-center gap-2 p-3 text-sm"
      >
        <Spinner />
        <Trans>正在读取对局存档…</Trans>
      </div>
    );
  if (state.saved)
    return (
      <GameRestoreDialog
        description={
          restoreDescription ?? <Trans>发现上次的对局存档，是否继续？</Trans>
        }
        busy={state.transitioning}
        error={state.error ? describeError(state.error, t) : undefined}
        onRestore={() => {
          onRestore?.();
          store.restore();
        }}
        onDiscard={() => {
          void store.exit();
        }}
      />
    );
  if (!state.error) return null;
  return (
    <div className="shrink-0 p-3">
      <Alert variant={state.error ? "destructive" : "default"}>
        <AlertDescription className="flex flex-col gap-2">
          <span>{describeError(state.error, t)}</span>
          <div className="flex flex-wrap items-center gap-2">
            {state.error ? (
              <Button
                size="sm"
                density="adaptive"
                variant="outline"
                disabled={state.transitioning}
                onClick={() => {
                  if (state.status === "error") void store.load();
                  else if (state.error?.code === "games:checkpoint_delete")
                    void store.exit();
                  else store.retrySave();
                }}
              >
                <Trans>重试</Trans>
              </Button>
            ) : null}
            {state.status === "error" ? (
              <Button
                size="sm"
                density="adaptive"
                variant="outline"
                disabled={state.transitioning}
                onClick={() => setDiscardOpen(true)}
              >
                <Trans comment="删除未完成的游戏存档，随后可开始新对局">
                  丢弃存档
                </Trans>
              </Button>
            ) : null}
          </div>
        </AlertDescription>
      </Alert>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>丢弃对局存档？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>此操作会删除该游戏的存档，无法继续上次的对局。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void store.exit();
              }}
            >
              <Trans comment="确认删除未完成的游戏存档">丢弃存档</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
