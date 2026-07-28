/**
 * Billiards game screen shell: header (volume, restart/exit), physics
 * loading gate, and mode switching. Shooting is a slingshot gesture on
 * the table (drag behind the cue ball to aim + charge, release to fire)
 * — the bottom bar only hosts the spin toggle and a live power readout.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import {
  CircleDot,
  Home,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Slider } from "~/components/ui/slider";
import { useSettingsStore } from "~/store/settings";
import { BilliardsMatch } from "./BilliardsMatch";
import { BilliardsModeMenu } from "./BilliardsModeMenu";
import { ensurePhysicsReady } from "./physics";
import { setGameAudioVolume, unlockAudio } from "./render/audio";
import type { BilliardsMode } from "./types";

export default function BilliardsGame() {
  const [physicsReady, setPhysicsReady] = useState(false);
  const [mode, setMode] = useState<BilliardsMode | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const gamesVolume = useSettingsStore((s) => s.gamesVolume);
  const setGamesVolume = useSettingsStore((s) => s.setGamesVolume);

  // Keep the WebAudio master gain in sync with the persisted setting.
  useEffect(() => {
    setGameAudioVolume(gamesVolume);
  }, [gamesVolume]);

  useEffect(() => {
    let cancelled = false;
    void ensurePhysicsReady().then(() => {
      if (!cancelled) setPhysicsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
            <CircleDot className="size-3.5" />
            <Trans>台球</Trans>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="音量">
                {gamesVolume > 0 ? <Volume2 /> : <VolumeX />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setGamesVolume(gamesVolume > 0 ? 0 : 0.7)}
                >
                  {gamesVolume > 0 ? (
                    <Volume2 className="size-4" />
                  ) : (
                    <VolumeX className="size-4" />
                  )}
                </button>
                <Slider
                  value={[Math.round(gamesVolume * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(values: number[]) =>
                    setGamesVolume(values[0] / 100)
                  }
                />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {Math.round(gamesVolume * 100)}
                </span>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {mode ? (
            <>
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
            </>
          ) : null}
        </div>
      </header>
      {!physicsReady ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Trans>正在加载物理引擎…</Trans>
        </div>
      ) : mode === null ? (
        <BilliardsModeMenu
          onStart={(nextMode) => {
            // Entering a match is a user gesture — the right moment to
            // unlock WebAudio (iOS autoplay policy).
            unlockAudio();
            setMode(nextMode);
          }}
        />
      ) : (
        <BilliardsMatch
          key={`${JSON.stringify(mode)}-${matchKey}`}
          mode={mode}
          onRematch={() => {
            // Swap who breaks each rematch so the AI and player alternate.
            setMode((m) =>
              m?.kind === "ai" ? { ...m, playerBreaks: !m.playerBreaks } : m,
            );
            setMatchKey((k) => k + 1);
          }}
          onExit={() => setMode(null)}
        />
      )}
    </main>
  );
}
