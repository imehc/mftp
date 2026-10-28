/** 黑白棋界面外壳：顶部操作与模式切换。 */
import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameHeaderActionsProvider } from "../engine/GameHeaderActions";
import { useGameAudio } from "../engine/use-game-audio";
import { useGameLifecycle } from "../engine/use-game-session";
import { reversiAudio, unlockReversiAudio } from "./audio";
import { ReversiHelp } from "./ReversiHelp";
import { ReversiMatch } from "./ReversiMatch";
import { ReversiModeMenu } from "./ReversiModeMenu";
import { ReversiOnlineFlow } from "./ReversiOnline";
import { ReversiSessionNotice } from "./ReversiSessionNotice";
import { reversiSessions } from "./session";

export default function ReversiGame() {
  return (
    <GameHeaderActionsProvider>
      <ReversiGameContent />
    </GameHeaderActionsProvider>
  );
}

function ReversiGameContent() {
  useGameAudio(reversiAudio);
  const lifecycle = useGameLifecycle(reversiSessions);
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
          title={<Trans comment="小游戏名称，标准八乘八翻转棋">黑白棋</Trans>}
          help={<ReversiHelp />}
          active={mode !== null}
          finished={matchFinished}
          canRestart={mode?.kind !== "online"}
          onRestart={restartMatch}
          onExit={exitMatch}
        />
      ) : null}
      <ReversiSessionNotice />
      {mode === null ? (
        lifecycle.canStart ? (
          <ReversiModeMenu
            onStart={(nextMode) => {
              unlockReversiAudio();
              setMatchFinished(false);
              lifecycle.start(nextMode);
            }}
          />
        ) : null
      ) : mode.kind === "online" ? (
        <ReversiOnlineFlow
          onPlayingChange={setOnlinePlaying}
          onExit={exitMatch}
          onFinishedChange={setMatchFinished}
        />
      ) : (
        <ReversiMatch
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
