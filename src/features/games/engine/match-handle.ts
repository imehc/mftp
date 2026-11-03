import type { MatchRunner, MatchSnapshot } from "./match";
import type { ControllerKind } from "./types";

/** 页面只获得观察和局内动作，完整历史及策略控制器保留在权威会话中。 */
export interface MatchHandle<O, M> {
  readonly id: string;
  readonly hasStarted: boolean;
  readonly controllers: readonly {
    kind: ControllerKind;
    awaitingInput?: boolean;
  }[];
  subscribe(listener: () => void): () => void;
  getSnapshot(): MatchSnapshot<O>;
  getObservationHistory(): readonly O[];
  start(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  undo(plies: number): boolean;
  submitLocal(move: M): boolean;
  readonly awaitingLocalInput: boolean;
}

export function createMatchHandle<S, M, P, O>(
  runner: MatchRunner<S, M, P, O>,
): MatchHandle<O, M> {
  return {
    id: runner.id,
    get hasStarted() {
      return runner.hasStarted;
    },
    get controllers() {
      return runner.controllers.map((controller) => ({
        kind: controller.kind,
        awaitingInput: controller.awaitingInput,
      }));
    },
    subscribe: runner.subscribe,
    getSnapshot: runner.getSnapshot,
    getObservationHistory: () => runner.getObservationHistory(),
    start: () => runner.start(),
    pause: () => runner.pause(),
    resume: () => runner.resume(),
    dispose: () => runner.dispose(),
    undo: (plies) => runner.undo(plies),
    submitLocal: (move) => runner.submitLocal(move),
    get awaitingLocalInput() {
      return runner.awaitingLocalInput;
    },
  };
}
