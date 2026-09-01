/** 围棋界面外壳：顶部操作与模式切换。 */
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Grid3x3 } from "lucide-react";
import { GameHomeButton, GameMatchActions } from "../engine/GameHeaderControls";
import { GameVolumeControl } from "../engine/GameVolumeControl";
import { unlockGoAudio } from "./audio";
import { GoMatch } from "./GoMatch";
import { GoModeMenu } from "./GoModeMenu";
import { GoOnlineFlow } from "./GoOnline";
import type { GoMode } from "./types";
export default function GoGame() {
  const [mode, setMode] = useState<GoMode | null>(null);
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
    <main className="bg-background text-foreground flex h-full flex-col overflow-hidden">
      <header className="border-border flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex items-center gap-1">
          <GameHomeButton
            matchActive={mode !== null}
            matchFinished={matchFinished}
          />
          <div className="bg-border h-4 w-px" />
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Grid3x3 className="size-3.5" />
            <Trans>围棋</Trans>
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
        <GoModeMenu
          onStart={(nextMode) => {
            unlockGoAudio();
            setMatchFinished(false);
            setMode(nextMode);
          }}
        />
      ) : mode.kind === "online" ? (
        <GoOnlineFlow
          boardSize={mode.boardSize}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <GoMatch
          key={`${JSON.stringify(mode)}-${matchKey}`}
          mode={mode}
          onRematch={() => {
            setMode((current) =>
              current?.kind === "ai"
                ? {
                    ...current,
                    localSeat: current.localSeat === 0 ? 1 : 0,
                  }
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
