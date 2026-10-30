import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";

import { toIpcError } from "~/lib/errors";
import type { AppError } from "~/types";

import { BoardGameHeader } from "../engine/BoardGameHeader";
import type { LocalGameSession } from "../engine/game-session-store";
import { useLocalGameSession } from "../engine/use-game-session";
import { BilliardsHelp } from "./BilliardsHelp";
import type { BilliardsHeaderProps } from "./BilliardsMatchHeader";
import { MatchView } from "./BilliardsMatchView";
import type { BilliardsStageHandle } from "./render/BilliardsStage";
import { billiardsSessions } from "./session";
import type {
  BilliardsMode,
  BilliardsMove,
  BilliardsPresentation,
  BilliardsState,
} from "./types";

export type Session = LocalGameSession<
  BilliardsState,
  BilliardsMove,
  BilliardsPresentation
>;

export function BilliardsMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
  headerProps,
}: {
  mode: BilliardsMode;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
  headerProps: BilliardsHeaderProps;
}) {
  const stageRef = useRef<BilliardsStageHandle | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const session = useLocalGameSession(
    billiardsSessions,
    async ({ seat, move, resolution }) => {
      if (move.type === "shot") {
        await stageRef.current?.animateCue(
          move.angle,
          move.power,
          billiardsSessions.getSnapshot().active?.session?.runner.controllers[
            seat
          ]?.kind === "ai",
        );
      }
      await stageRef.current?.playPresentation(resolution.presentation);
    },
    false,
  );
  if (!session)
    return (
      <>
        <BoardGameHeader
          title={<Trans>台球</Trans>}
          active={headerProps.active}
          finished={headerProps.finished}
          canRestart
          onRestart={headerProps.onRestart}
          onExit={headerProps.onExit}
          landscape={headerProps.landscape}
          help={<BilliardsHelp discipline={mode.discipline ?? "eight-ball"} />}
        />
        <div className="flex-1" />
      </>
    );
  return (
    <MatchView
      mode={mode}
      headerProps={headerProps}
      session={session}
      stageRef={stageRef}
      onRematch={onRematch}
      onExit={onExit}
      onFinishedChange={onFinishedChange}
      stageError={error}
      onStageError={(cause) => {
        session.runner.pause();
        setError(toIpcError(cause).payload);
      }}
    />
  );
}
