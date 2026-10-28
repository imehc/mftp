import { Trans, useLingui } from "@lingui/react/macro";
import { useSyncExternalStore } from "react";

import { describeError } from "~/lib/errors";

import { GameRestoreDialog } from "../engine/GameRestoreDialog";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { unlockReversiAudio } from "./audio";
import { reversiSessions } from "./session";

export function ReversiSessionNotice() {
  const { t } = useLingui();
  const state = useSyncExternalStore(
    reversiSessions.subscribe,
    reversiSessions.getSnapshot,
  );
  if (state.saved)
    return (
      <GameRestoreDialog
        description={
          <Trans>继续上次的黑白棋对局，棋盘和悔棋记录都会恢复。</Trans>
        }
        busy={state.transitioning}
        error={state.error ? describeError(state.error, t) : undefined}
        onRestore={() => {
          unlockReversiAudio();
          reversiSessions.restore();
        }}
        onDiscard={() => {
          void reversiSessions.exit();
        }}
      />
    );
  return <GameSessionNotice store={reversiSessions} />;
}
