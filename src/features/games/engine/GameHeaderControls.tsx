import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { Home, LogOut, RotateCcw } from "lucide-react";
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

export function GameHomeButton({
  matchActive,
  matchFinished,
}: {
  matchActive: boolean;
  matchFinished: boolean;
}) {
  if (!matchActive || matchFinished) {
    return (
      <Button variant="ghost" size="xs" asChild>
        <Link to="/">
          <Home data-icon="inline-start" />
          <Trans>首页</Trans>
        </Link>
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <Home data-icon="inline-start" />
          <Trans>首页</Trans>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle><Trans>返回首页?</Trans></AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>当前对局尚未结束，返回首页将丢失进度。</Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel><Trans>取消</Trans></AlertDialogCancel>
          <AlertDialogAction asChild>
            <Link to="/"><Trans>返回首页</Trans></Link>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestartButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick}>
      <RotateCcw data-icon="inline-start" />
      <Trans>重开</Trans>
    </Button>
  );
}

function ExitButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick}>
      <LogOut data-icon="inline-start" />
      <Trans>退出对局</Trans>
    </Button>
  );
}

export function GameMatchActions({
  matchFinished,
  canRestart,
  onRestart,
  onExit,
}: {
  matchFinished: boolean;
  canRestart: boolean;
  onRestart: () => void;
  onExit: () => void;
}) {
  return (
    <>
      {canRestart ? (
        matchFinished ? (
          <RestartButton onClick={onRestart} />
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild><RestartButton /></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle><Trans>重新开始对局?</Trans></AlertDialogTitle>
                <AlertDialogDescription><Trans>当前对局的进度将会丢失。</Trans></AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel><Trans>取消</Trans></AlertDialogCancel>
                <AlertDialogAction onClick={onRestart}><Trans>重开</Trans></AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      ) : null}
      {matchFinished ? (
        <ExitButton onClick={onExit} />
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild><ExitButton /></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle><Trans>退出当前对局?</Trans></AlertDialogTitle>
              <AlertDialogDescription>
                <Trans>将返回模式选择,当前对局的进度将会丢失。</Trans>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel><Trans>取消</Trans></AlertDialogCancel>
              <AlertDialogAction onClick={onExit}><Trans>退出</Trans></AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
