import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Crown } from "lucide-react";
import { GameHomeButton, GameMatchActions } from "../engine/GameHeaderControls";
import { GameVolumeControl } from "../engine/GameVolumeControl";
import { unlockXiangqiAudio } from "./audio";
import { XiangqiMatch } from "./XiangqiMatch";
import { XiangqiModeMenu } from "./XiangqiModeMenu";
import { XiangqiOnlineFlow } from "./XiangqiOnline";
import type { XiangqiMode } from "./types";

export default function XiangqiGame() {
  const [mode, setMode] = useState<XiangqiMode | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [matchFinished, setMatchFinished] = useState(false);

  const exitMatch = () => {
    setMatchFinished(false);
    setMode(null);
  };

  const restartMatch = () => {
    setMatchFinished(false);
    setMatchKey((key) => key + 1);
  };

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          <GameHomeButton matchActive={mode !== null} matchFinished={matchFinished} />
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Crown className="size-3.5" />
            <Trans>中国象棋</Trans>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <GameVolumeControl />
          {mode ? (
            <GameMatchActions
              matchFinished={matchFinished}
              canRestart={mode.kind !== "online"}
              onRestart={restartMatch}
              onExit={exitMatch}
            />
          ) : null}
        </div>
      </header>
      {mode === null ? (
        <XiangqiModeMenu
          onStart={(nextMode) => {
            unlockXiangqiAudio();
            setMatchFinished(false);
            setMode(nextMode);
          }}
        />
      ) : mode.kind === "online" ? (
        <XiangqiOnlineFlow
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <XiangqiMatch
          key={`${JSON.stringify(mode)}-${matchKey}`}
          mode={mode}
          onRematch={() => {
            setMode((current) =>
              current?.kind === "ai"
                ? { ...current, localSeat: current.localSeat === 0 ? 1 : 0 }
                : current,
            );
            setMatchFinished(false);
            setMatchKey((key) => key + 1);
          }}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      )}
    </main>
  );
}
