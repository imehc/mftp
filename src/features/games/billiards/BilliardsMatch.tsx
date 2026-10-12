/** 对局生命周期：为器材创建独立Worker、控制器和回放桥接。 */
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { describeError, toIpcError } from "~/lib/errors";
import type { AppError } from "~/types";

import { AiController, LocalController } from "../engine/controllers";
import { MatchRunner } from "../engine/match";
import type { PlayerController } from "../engine/types";
import { createBilliardsAiStrategy } from "./ai";
import { MatchView } from "./BilliardsMatchView";
import { createNineBallState } from "./nine-ball";
import { equipmentForState } from "./placement";
import type { BilliardsStageHandle } from "./render/BilliardsStage";
import { createBilliardsGame, createInitialState } from "./rules";
import { createSimulationClient } from "./simulation-client";
import { createSnookerState } from "./snooker";
import type {
  BilliardsMode,
  BilliardsMove,
  BilliardsPresentation,
  BilliardsState,
} from "./types";

export interface Session {
  runner: MatchRunner<BilliardsState, BilliardsMove, BilliardsPresentation>;
  local: LocalController<BilliardsState, BilliardsMove>;
}

export function BilliardsMatch({
  mode,
  onRematch,
  onExit,
  onFinishedChange,
}: {
  mode: BilliardsMode;
  onRematch: () => void;
  onExit: () => void;
  onFinishedChange: (finished: boolean) => void;
}) {
  const stageRef = useRef<BilliardsStageHandle | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => {
    const discipline = mode.discipline ?? "eight-ball";
    const variant = mode.kind === "practice" ? "practice" : discipline;
    const firstSeat =
      mode.kind === "ai"
        ? mode.playerBreaks
          ? 0
          : 1
        : mode.kind === "hotseat"
          ? (mode.firstSeat ?? 0)
          : 0;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const initial =
      variant === "nine-ball"
        ? createNineBallState(firstSeat, seed)
        : variant === "snooker"
          ? createSnookerState(
              mode.discipline === "snooker" ? mode.reds : 15,
              firstSeat,
              seed,
            )
          : createInitialState(
              variant,
              firstSeat,
              discipline,
              seed,
              mode.discipline === "snooker" ? mode.reds : 15,
            );
    const equipment = equipmentForState(initial);
    const simulation = createSimulationClient(equipment.id);
    const game = createBilliardsGame(variant, simulation.shot);
    const local = new LocalController<BilliardsState, BilliardsMove>();
    const controllers: PlayerController<BilliardsState, BilliardsMove>[] =
      mode.kind === "practice"
        ? [local]
        : mode.kind === "hotseat"
          ? [local, local]
          : [
              local,
              new AiController(
                createBilliardsAiStrategy(simulation.shot, equipment),
                mode.difficulty,
              ),
            ];
    const runner = new MatchRunner(game, initial, controllers, {
      onMoveResolved: async ({ seat, move, resolution }) => {
        if (move.type === "shot") {
          await stageRef.current?.animateCue(
            move.angle,
            move.power,
            controllers[seat]?.kind === "ai",
          );
        }
        await stageRef.current?.playPresentation(resolution.presentation);
      },
      onError: (cause) => {
        if (!cancelled) setError(toIpcError(cause).payload);
      },
    });
    // 用微任务延迟，使 setState 发生在 effect 主体之外；cancelled 标记
    // 用于防止严格模式重挂载时发布已被销毁的 runner。
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        setSession({
          runner,
          local,
        });
    });
    return () => {
      cancelled = true;
      runner.dispose();
      simulation.dispose();
      setSession(null);
    };
    // 每个 <BilliardsMatch key=...> 实例的 mode 标识是稳定的。
  }, [mode]);
  if (!session) return <div className="flex-1" />;
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      ) : null}
      <MatchView
        mode={mode}
        session={session}
        stageRef={stageRef}
        onRematch={onRematch}
        onExit={onExit}
        onFinishedChange={onFinishedChange}
        onStageError={(cause) => {
          session.runner.dispose();
          setError(toIpcError(cause).payload);
        }}
      />
    </>
  );
}
