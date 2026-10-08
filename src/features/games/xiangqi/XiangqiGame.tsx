import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { unlockXiangqiAudio } from "./audio";
import type { XiangqiMode } from "./types";
import { XiangqiMatch } from "./XiangqiMatch";
import { XiangqiModeMenu } from "./XiangqiModeMenu";
import { XiangqiOnlineFlow } from "./XiangqiOnline";

export default function XiangqiGame() {
  const [mode, setMode] = useState<XiangqiMode | null>(null);
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
          title={<Trans>中国象棋</Trans>}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
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
          onPlayingChange={setOnlinePlaying}
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
