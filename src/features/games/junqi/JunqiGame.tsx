import "./junqi.css";

import { Trans } from "@lingui/react/macro";
import { useState } from "react";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import { GameHeaderActionsProvider } from "../engine/GameHeaderActions";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useGameAudio } from "../engine/use-game-audio";
import { useGameLifecycle } from "../engine/use-game-session";
import { junqiAudio } from "./audio";
import { JunqiHelp } from "./JunqiHelp";
import { JunqiMatch } from "./JunqiMatch";
import { JunqiModeMenu } from "./JunqiModeMenu";
import { JunqiOnlineFlow } from "./JunqiOnline";
import { junqiSessions } from "./session";
import type { JunqiVariant } from "./types";

export default function JunqiGame() {
  return (
    <GameHeaderActionsProvider>
      <JunqiGameContent />
    </GameHeaderActionsProvider>
  );
}

function JunqiGameContent() {
  useGameAudio(junqiAudio);
  const lifecycle = useGameLifecycle(junqiSessions);
  const [variant, setVariant] = useState<JunqiVariant>("open");
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      {lifecycle.mode?.kind === "online" ? (
        <JunqiOnlineFlow
          key={lifecycle.matchKey}
          variant={lifecycle.mode.variant}
          onExit={lifecycle.exit}
        />
      ) : lifecycle.mode ? (
        <JunqiMatch
          key={lifecycle.matchKey}
          mode={lifecycle.mode}
          onRestart={lifecycle.restart}
          onExit={lifecycle.exit}
        />
      ) : (
        <>
          <BoardGameHeader
            title={<Trans>陆战棋</Trans>}
            active={false}
            finished={false}
            canRestart={false}
            onRestart={lifecycle.restart}
            onExit={lifecycle.exit}
            help={<JunqiHelp variant={variant} />}
          />
          <GameSessionNotice
            store={junqiSessions}
            onRestore={junqiAudio.unlock}
          />
          {lifecycle.canStart ? (
            <JunqiModeMenu
              variant={variant}
              onVariant={setVariant}
              onStart={(mode) => {
                junqiAudio.unlock();
                lifecycle.start(mode);
              }}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
