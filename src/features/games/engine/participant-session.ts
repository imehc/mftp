import type { AiStrategy } from "./ai";
import { ComputerController, LocalController } from "./controllers";
import { type MatchHooks, MatchRunner } from "./match";
import { sameParticipantConfiguration } from "./participant-configuration";
import {
  type ParticipantConfiguration,
  type SeatConfiguration,
  validateParticipants,
} from "./participants";
import type { GameDefinition, PlayerController } from "./types";

/** 适配只提供策略或控制器工厂，不重新拥有一套对局循环。 */
export interface GameParticipantAdapters<O, M> {
  computer?: AiStrategy<O, M>;
  remote?(
    configuration: Extract<SeatConfiguration, { kind: "remote" }>,
  ): PlayerController<O, M>;
}

export function participantCapabilities<O, M>(
  adapters: GameParticipantAdapters<O, M>,
) {
  return {
    local: true,
    computer: !!adapters.computer,
    remote: !!adapters.remote,
  } as const;
}

export function createParticipantSession<S, M, P, O>(
  game: GameDefinition<S, M, P, O>,
  initial: S,
  configuration: ParticipantConfiguration,
  adapters: GameParticipantAdapters<O, M>,
  hooks: MatchHooks<S, M, P, O> = {},
  checkpoint?: {
    id: string;
    history?: readonly S[];
    participants?: ParticipantConfiguration;
    rulesVersion?: number;
  },
  minThinkMs = 350,
) {
  validateParticipants(configuration, game.seatCount);
  // 无规则版本的历史存档只按第一版读取，不猜测后续规则是否兼容。
  if (checkpoint?.history && (checkpoint.rulesVersion ?? 1) !== game.version)
    throw new Error("Saved rules version does not match the game");
  if (
    checkpoint?.participants &&
    !sameParticipantConfiguration(configuration, checkpoint.participants)
  )
    throw new Error("Saved participants do not match the match configuration");
  const locals = new Map<number, LocalController<O, M>>();
  const controllers: PlayerController<O, M>[] = [];
  try {
    for (const seat of [...configuration.seats].sort(
      (left, right) => left.seat - right.seat,
    )) {
      let controller: PlayerController<O, M>;
      if (seat.kind === "local") {
        const local = new LocalController<O, M>();
        controller = local;
        locals.set(seat.seat, local);
      } else if (seat.kind === "computer" && adapters.computer) {
        controller = new ComputerController(
          adapters.computer,
          seat.difficulty,
          minThinkMs,
        );
      } else if (seat.kind === "remote" && adapters.remote) {
        controller = adapters.remote(seat);
      } else {
        throw new Error(
          `Game ${game.id} does not support ${seat.kind} participants`,
        );
      }
      if (controller.kind !== seat.kind) {
        controller.dispose?.();
        throw new Error(
          "Game controller kind does not match its seat configuration",
        );
      }
      controllers.push(controller);
    }
    const runner = new MatchRunner(
      game,
      initial,
      controllers,
      hooks,
      checkpoint,
      configuration,
    );
    return { runner, locals };
  } catch (error) {
    for (const controller of controllers) controller.dispose?.();
    throw error;
  }
}
