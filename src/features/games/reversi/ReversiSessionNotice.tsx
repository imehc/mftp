import { Trans } from "@lingui/react/macro";

import { GameSessionNotice } from "../engine/GameSessionNotice";
import { unlockReversiAudio } from "./audio";
import { reversiSessions } from "./session";

export function ReversiSessionNotice() {
  return (
    <GameSessionNotice
      store={reversiSessions}
      onRestore={unlockReversiAudio}
      restoreDescription={
        <Trans>继续上次的黑白棋对局，棋盘和悔棋记录都会恢复。</Trans>
      }
    />
  );
}
