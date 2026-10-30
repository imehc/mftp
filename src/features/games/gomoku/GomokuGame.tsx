/** 五子棋界面外壳：顶部操作与模式切换。 */
import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameHeaderActionsProvider } from "../engine/GameHeaderActions";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useGameAudio } from "../engine/use-game-audio";
import { useGameLifecycle } from "../engine/use-game-session";
import { gomokuAudio, unlockGomokuAudio } from "./audio";
import { GomokuHelp } from "./GomokuHelp";
import { GomokuMatch } from "./GomokuMatch";
import { GomokuModeMenu } from "./GomokuModeMenu";
import { GomokuOnlineFlow } from "./GomokuOnline";
import { gomokuSessions } from "./session";

export default function GomokuGame() {
  return (
    <GameHeaderActionsProvider>
      <GomokuGameContent />
    </GameHeaderActionsProvider>
  );
}

function GomokuGameContent() {
  useGameAudio(gomokuAudio);
  const lifecycle = useGameLifecycle(gomokuSessions);
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
          title={<Trans>五子棋</Trans>}
          help={<GomokuHelp />}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
      <GameSessionNotice store={gomokuSessions} onRestore={unlockGomokuAudio} />
      {mode === null ? (
        lifecycle.canStart ? (
          <GomokuModeMenu
            onStart={(nextMode) => {
              unlockGomokuAudio();
              setMatchFinished(false);
              lifecycle.start(nextMode);
            }}
          />
        ) : null
      ) : mode.kind === "online" ? (
        <GomokuOnlineFlow
          onPlayingChange={setOnlinePlaying}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <GomokuMatch
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
