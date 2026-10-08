import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useBlocker } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useState } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
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

import { GameActionsMenu } from "./GameActionsMenu";
import { GameVolumeControl } from "./GameVolumeControl";

export function BoardGameHeader({
  title,
  active,
  finished,
  canRestart,
  onRestart,
  onExit,
}: {
  title: ReactNode;
  active: boolean;
  finished: boolean;
  canRestart: boolean;
  onRestart: () => void;
  onExit: () => void;
}) {
  const { t } = useLingui();
  const [confirm, setConfirm] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      active && !finished && current.pathname !== next.pathname,
    enableBeforeUnload: active && !finished,
    withResolver: true,
  });
  return (
    <>
      <ToolPageHeader
        showHome={false}
        title={title}
        leading={
          active ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`返回模式选择`}
              onClick={() => (finished ? onExit() : setConfirm(true))}
            >
              <ArrowLeft />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" asChild>
              <Link
                to="/"
                search={{ category: "games" }}
                aria-label={t`返回首页`}
              >
                <ArrowLeft />
              </Link>
            </Button>
          )
        }
        trailing={
          active ? (
            <GameActionsMenu
              matchFinished={finished}
              canRestart={canRestart}
              onRestart={onRestart}
              onExit={onExit}
            />
          ) : (
            <GameVolumeControl />
          )
        }
      />
      <AlertDialog
        open={confirm || blocker.status === "blocked"}
        onOpenChange={(open) => {
          setConfirm(open);
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>退出当前对局？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {blocker.status === "blocked" ? (
                <Trans>当前对局尚未结束，离开后将丢失进度。</Trans>
              ) : (
                <Trans>将返回模式选择，当前对局的进度将会丢失。</Trans>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (blocker.status === "blocked") blocker.proceed();
                else onExit();
              }}
            >
              <Trans>退出</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
