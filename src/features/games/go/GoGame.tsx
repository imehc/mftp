/** 围棋界面外壳：顶部操作与模式切换。 */
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { BoardGameHeader } from "../engine/BoardGameHeader";
import { unlockGoAudio } from "./audio";
import { GoMatch } from "./GoMatch";
import { GoModeMenu } from "./GoModeMenu";
import { GoOnlineFlow } from "./GoOnline";
import type { GoMode } from "./types";
export default function GoGame() {
  const [mode, setMode] = useState<GoMode | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [onlinePlaying, setOnlinePlaying] = useState(false);
  const [matchFinished, setMatchFinished] = useState(false);
  const exitMatch = () => {
    setOnlinePlaying(false);
    setMatchFinished(false);
    setMode(null);
  };
  const restartMatch = () => {
    setMatchFinished(false);
    setMatchKey((key) => key + 1);
  };
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      {mode?.kind !== "online" || onlinePlaying ? (
        <BoardGameHeader
          title={<Trans>围棋</Trans>}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
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
          onPlayingChange={setOnlinePlaying}
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
