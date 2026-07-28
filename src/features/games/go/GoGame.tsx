/** Go screen shell: header actions and mode switching. */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { Grid3x3, Home, RotateCcw } from "lucide-react";
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
import { unlockGoAudio } from "./audio";
import { GoMatch } from "./GoMatch";
import { GoModeMenu } from "./GoModeMenu";
import { GoOnlineFlow } from "./GoOnline";
import type { GoMode } from "./types";

export default function GoGame() {
  const [mode, setMode] = useState<GoMode | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" asChild>
            <Link to="/">
              <Home data-icon="inline-start" />
              <Trans>首页</Trans>
            </Link>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Grid3x3 className="size-3.5" />
            <Trans>围棋</Trans>
          </div>
        </div>
        {mode ? (
          <div className="flex items-center gap-1">
            {mode.kind !== "online" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="xs">
                    <RotateCcw data-icon="inline-start" />
                    <Trans>重开</Trans>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      <Trans>重新开始对局?</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <Trans>当前对局的进度将会丢失。</Trans>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      <Trans>取消</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => setMatchKey((k) => k + 1)}>
                      <Trans>重开</Trans>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="xs">
                  <Trans>退出对局</Trans>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    <Trans>退出当前对局?</Trans>
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <Trans>将返回模式选择,当前对局的进度将会丢失。</Trans>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <Trans>取消</Trans>
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={() => setMode(null)}>
                    <Trans>退出</Trans>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </header>
      {mode === null ? (
        <GoModeMenu
          onStart={(nextMode) => {
            unlockGoAudio();
            setMode(nextMode);
          }}
        />
      ) : mode.kind === "online" ? (
        <GoOnlineFlow boardSize={mode.boardSize} onExit={() => setMode(null)} />
      ) : (
        <GoMatch
          key={`${JSON.stringify(mode)}-${matchKey}`}
          mode={mode}
          onRematch={() => setMatchKey((k) => k + 1)}
          onExit={() => setMode(null)}
        />
      )}
    </main>
  );
}
