import type { AiStrategy, Difficulty } from "./ai";
import type { LocalGameInput } from "./game-session-store";
import type { MatchHooks } from "./match";
import { sameParticipantConfiguration } from "./participant-configuration";
import { createParticipantSession } from "./participant-session";
import type {
  ParticipantConfiguration,
  SeatConfiguration,
} from "./participants";
import type { GameDefinition } from "./types";

export type BoardMode =
  | { kind: "hotseat" }
  | { kind: "ai"; localSeat: number; difficulty: Difficulty }
  | { kind: "online" };

export function boardParticipantConfiguration(
  mode: Exclude<BoardMode, { kind: "online" }>,
): ParticipantConfiguration {
  const seats: SeatConfiguration[] = [0, 1].map((seat) => {
    if (mode.kind === "hotseat" || seat === mode.localSeat)
      return { seat, kind: "local" };
    return { seat, kind: "computer", difficulty: mode.difficulty };
  });
  return {
    version: 1,
    seats,
    viewerSeat: mode.kind === "hotseat" ? "active" : mode.localSeat,
  };
}

export function createBoardSession<State, Move, Presentation, Observation>(
  mode: BoardMode,
  game: GameDefinition<State, Move, Presentation, Observation>,
  initial: State,
  strategy: AiStrategy<Observation, Move>,
  hooks: MatchHooks<State, Move, Presentation, Observation>,
  checkpoint: {
    id: string;
    history?: State[];
    participants?: ParticipantConfiguration;
    rulesVersion?: number;
  },
) {
  if (mode.kind === "online")
    throw new Error("Online matches require a room session");
  const expected = boardParticipantConfiguration(mode);
  if (
    checkpoint.participants &&
    !sameParticipantConfiguration(checkpoint.participants, expected)
  )
    throw new Error("Saved participants do not match the game mode");
  const session = createParticipantSession(
    game,
    initial,
    expected,
    {
      computer: strategy,
    },
    hooks,
    checkpoint,
  );
  const local: LocalGameInput<Move> = {
    submit: (move) => session.runner.submitLocal(move),
    get awaitingInput() {
      return session.runner.awaitingLocalInput;
    },
  };
  return { ...session, local };
}
