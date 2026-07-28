/**
 * Billiards game screen shell: header (volume, restart/exit), physics
 * loading gate, and mode switching. Shooting is a slingshot gesture on
 * the table (drag behind the cue ball to aim + charge, release to fire)
 * — the bottom bar only hosts the spin toggle and a live power readout.
 */
import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { CircleDot } from "lucide-react";
import { useSettingsStore } from "~/store/settings";
import { GameHomeButton, GameMatchActions } from "../engine/GameHeaderControls";
import { GameVolumeControl } from "../engine/GameVolumeControl";
import { BilliardsMatch } from "./BilliardsMatch";
import { BilliardsModeMenu } from "./BilliardsModeMenu";
import { ensurePhysicsReady } from "./physics";
import { setGameAudioVolume, unlockAudio } from "./render/audio";
import type { BilliardsMode } from "./types";

export default function BilliardsGame() {
  const [physicsReady, setPhysicsReady] = useState(false);
  const [mode, setMode] = useState<BilliardsMode | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [matchFinished, setMatchFinished] = useState(false);
  const gamesVolume = useSettingsStore((s) => s.gamesVolume);

  const exitMatch = () => {
    setMatchFinished(false);
    setMode(null);
  };

  const restartMatch = () => {
    setMatchFinished(false);
    setMatchKey((key) => key + 1);
  };

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
          <GameHomeButton matchActive={mode !== null} matchFinished={matchFinished} />
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleDot className="size-3.5" />
            <Trans>台球</Trans>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <GameVolumeControl />
          {mode ? (
            <GameMatchActions
              matchFinished={matchFinished}
              canRestart
              onRestart={restartMatch}
              onExit={exitMatch}
            />
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
            setMatchFinished(false);
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
            setMatchFinished(false);
            setMatchKey((k) => k + 1);
          }}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      )}
    </main>
  );
}
