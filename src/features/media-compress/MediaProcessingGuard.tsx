import { Trans } from "@lingui/react/macro";
import { useBlocker } from "@tanstack/react-router";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

const ProcessingContext = createContext<Dispatch<
  SetStateAction<Set<string>>
> | null>(null);

export function useMediaProcessing(id: string, processing: boolean) {
  const register = useContext(ProcessingContext);
  useEffect(() => {
    if (!processing || !register) return;
    register((current) => new Set(current).add(id));
    return () =>
      register((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
  }, [id, processing, register]);
}

export function MediaProcessingGuard({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Set<string>>(() => new Set());
  // 已访问模式保持挂载；只有离开媒体工作区才会终止本页持有的处理任务。
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) =>
      active.size > 0 && next.pathname !== "/tools/media-compress",
    enableBeforeUnload: active.size > 0,
    withResolver: true,
  });
  return (
    <ProcessingContext value={setActive}>
      {children}
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>停止处理并离开？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>离开会停止当前媒体处理，原文件会保留。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>继续处理</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>
              <Trans>停止并离开</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProcessingContext>
  );
}

export function MediaCancelButton({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" density="adaptive">
          <Trans>取消处理</Trans>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="ui-density-adaptive">
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>停止当前处理？</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>取消后将丢弃本次处理进度，原文件会保留。</Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>继续处理</Trans>
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <Trans>停止处理</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
