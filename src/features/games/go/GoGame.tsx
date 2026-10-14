/** 围棋界面外壳：顶部操作与模式切换。 */
import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useGameAudio } from "../engine/use-game-audio";
import { useGameLifecycle } from "../engine/use-game-session";
import { goAudio, unlockGoAudio } from "./audio";
import { GoMatch } from "./GoMatch";
import { GoModeMenu } from "./GoModeMenu";
import { GoOnlineFlow } from "./GoOnline";
import { goSessions } from "./session";

export default function GoGame() {
  useGameAudio(goAudio);
  const lifecycle = useGameLifecycle(goSessions);
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
          title={<Trans>围棋</Trans>}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
      <GameSessionNotice store={goSessions} onRestore={unlockGoAudio} />
      {mode === null ? (
        lifecycle.canStart ? (
          <GoModeMenu
            onStart={(nextMode) => {
              unlockGoAudio();
              setMatchFinished(false);
              lifecycle.start(nextMode);
            }}
          />
        ) : null
      ) : mode.kind === "online" ? (
        <GoOnlineFlow
          onPlayingChange={setOnlinePlaying}
          boardSize={mode.boardSize}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <GoMatch
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
