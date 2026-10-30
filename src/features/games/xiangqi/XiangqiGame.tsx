import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameHeaderActionsProvider } from "../engine/GameHeaderActions";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useGameAudio } from "../engine/use-game-audio";
import { useGameLifecycle } from "../engine/use-game-session";
import { unlockXiangqiAudio, xiangqiAudio } from "./audio";
import { xiangqiSessions } from "./session";
import { XiangqiHelp } from "./XiangqiHelp";
import { XiangqiMatch } from "./XiangqiMatch";
import { XiangqiModeMenu } from "./XiangqiModeMenu";
import { XiangqiOnlineFlow } from "./XiangqiOnline";

export default function XiangqiGame() {
  return (
    <GameHeaderActionsProvider>
      <XiangqiGameContent />
    </GameHeaderActionsProvider>
  );
}

function XiangqiGameContent() {
  useGameAudio(xiangqiAudio);
  const lifecycle = useGameLifecycle(xiangqiSessions);
  const { mode, matchKey } = lifecycle;
  const [onlinePlaying, setOnlinePlaying] = useState(false);
  const [matchFinished, setMatchFinished] = useState(false);

  const exitMatch = () => {
    setOnlinePlaying(false);
    setMatchFinished(false);
    lifecycle.exit();
  };

  const restartMatch = () => {
    setMatchFinished(false);
    lifecycle.restart();
  };

  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      {mode?.kind !== "online" || onlinePlaying ? (
        <BoardGameHeader
          title={<Trans>中国象棋</Trans>}
          help={<XiangqiHelp />}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
      <GameSessionNotice
        store={xiangqiSessions}
        onRestore={unlockXiangqiAudio}
      />
      {mode === null ? (
        lifecycle.canStart ? (
          <XiangqiModeMenu
            onStart={(nextMode) => {
              unlockXiangqiAudio();
              setMatchFinished(false);
              lifecycle.start(nextMode);
            }}
          />
        ) : null
      ) : mode.kind === "online" ? (
        <XiangqiOnlineFlow
          onPlayingChange={setOnlinePlaying}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <XiangqiMatch
          key={matchKey}
          mode={mode}
          onRematch={() => {
            lifecycle.rematch((current) =>
              current?.kind === "ai"
                ? {
                    ...current,
                    localSeat: current.localSeat === 0 ? 1 : 0,
                  }
                : current,
            );
            setMatchFinished(false);
          }}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      )}
    </main>
  );
}
