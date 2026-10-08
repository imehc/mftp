/** 五子棋界面外壳：顶部操作与模式切换。 */
import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { unlockGomokuAudio } from "./audio";
import { GomokuMatch } from "./GomokuMatch";
import { GomokuModeMenu } from "./GomokuModeMenu";
import { GomokuOnlineFlow } from "./GomokuOnline";
import type { GomokuMode } from "./types";

export default function GomokuGame() {
  const [mode, setMode] = useState<GomokuMode | null>(null);
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
          title={<Trans>五子棋</Trans>}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
      {mode === null ? (
        <GomokuModeMenu
          onStart={(nextMode) => {
            unlockGomokuAudio();
            setMatchFinished(false);
            setMode(nextMode);
          }}
        />
      ) : mode.kind === "online" ? (
        <GomokuOnlineFlow
          onPlayingChange={setOnlinePlaying}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <GomokuMatch
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
