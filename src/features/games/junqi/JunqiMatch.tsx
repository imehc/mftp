import { Trans } from "@lingui/react/macro";

import { Spinner } from "~/components/ui/spinner";
import { useSettingsStore } from "~/store/settings";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import type { LocalGameSession } from "../engine/game-session-store";
import { GameSessionNotice } from "../engine/GameSessionNotice";
import { useMatchSnapshot } from "../engine/match";
import { useLocalGameSession } from "../engine/use-game-session";
import { playJunqiMove } from "./audio";
import { JunqiMatchView } from "./JunqiMatchView";
import { JunqiRulesDialog } from "./JunqiRulesDialog";
import { junqiSessions } from "./session";
import type {
  JunqiLocalMode,
  JunqiMove,
  JunqiPresentation,
  JunqiState,
} from "./types";
import { projectView } from "./visibility";

interface MatchProps {
  mode: JunqiLocalMode;
  onRestart(): void;
  onExit(): void;
}

export function JunqiMatch(props: MatchProps) {
  const volume = useSettingsStore((state) => state.gamesVolume);
  const session = useLocalGameSession(junqiSessions, ({ resolution }) => {
    if (resolution.presentation.moved)
      playJunqiMove(volume, resolution.presentation.capture);
  });
  if (!session)
    return (
      <>
        <BoardGameHeader
          title={<Trans>陆战棋</Trans>}
          active
          finished={false}
          canRestart
          onRestart={props.onRestart}
          onExit={props.onExit}
          help={<JunqiRulesDialog variant={props.mode.variant} />}
        />
        <GameSessionNotice store={junqiSessions} />
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2"
        >
          <Spinner />
          <Trans>正在准备对局…</Trans>
        </div>
      </>
    );
  return <LocalMatch {...props} session={session} />;
}

function LocalMatch({
  mode,
  onRestart,
  onExit,
  session,
}: MatchProps & {
  session: LocalGameSession<JunqiState, JunqiMove, JunqiPresentation>;
}) {
  const { runner, local } = session;
  const snapshot = useMatchSnapshot(runner);
  const interactive =
    snapshot.phase === "awaiting-move" &&
    snapshot.activeSeat === mode.localSeat;
  return (
    <JunqiMatchView
      mode={mode}
      view={projectView(snapshot.state, mode.localSeat)}
      localSeat={mode.localSeat}
      interactive={interactive}
      recordId={runner.id}
      onRestart={onRestart}
      onExit={onExit}
      notice={<GameSessionNotice store={junqiSessions} />}
      onAction={(action) => {
        if (
          runner.getSnapshot() !== snapshot ||
          !local.awaitingInput ||
          !interactive
        )
          return;
        local.submit(
          action.type === "arrange"
            ? {
                type: "arrange",
                seed: crypto.getRandomValues(new Uint32Array(1))[0],
              }
            : action,
        );
      }}
    />
  );
}
