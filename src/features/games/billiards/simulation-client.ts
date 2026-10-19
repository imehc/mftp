import { type EquipmentId } from "./equipment";
/** 每个对局/预览拥有自己的 worker，结束时终止计算并兑现所有等待。 */
import type { ShotParams, ShotSimResult } from "./physics";
import type { AimGuide } from "./render/guides";
import type { BallState } from "./types";

export type ShotSimulator = (
  balls: readonly BallState[],
  shot: ShotParams,
) => ShotSimResult | Promise<ShotSimResult>;

export interface SimulationRequest {
  id: number;
  kind: "shot" | "preview";
  equipmentId: EquipmentId;
  balls: readonly BallState[];
  shot: ShotParams;
}

/** ready 只等物理引擎初始化，不带球位与击球参数；失败后可重试。 */
export interface SimulationReadyRequest {
  id: number;
  kind: "ready";
}

export type SimulationResponse =
  | { id: number; result: ShotSimResult | AimGuide | null }
  | { id: number; error: string };

export function createSimulationClient(
  equipmentId: EquipmentId = "chinese-eight",
) {
  const worker = new Worker(
    new URL("./simulation.worker.ts", import.meta.url),
    { type: "module" },
  );
  let nextId = 0;
  let disposed = false;
  const pending = new Map<
    number,
    {
      resolve(value: ShotSimResult | AimGuide | null): void;
      reject(error: Error): void;
    }
  >();

  const fail = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.onmessage = ({ data }: MessageEvent<SimulationResponse>) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if ("error" in data) request?.reject(new Error(data.error));
    else request?.resolve(data.result);
  };
  worker.onerror = () => {
    disposed = true;
    worker.terminate();
    fail(new Error("billiards: simulation worker failed"));
  };
  const request = (
    kind: SimulationRequest["kind"],
    balls: readonly BallState[],
    shot: ShotParams,
  ) =>
    new Promise<ShotSimResult | AimGuide | null>((resolve, reject) => {
      if (disposed) {
        reject(new DOMException("Disposed", "AbortError"));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({
          id,
          kind,
          equipmentId,
          balls,
          shot,
        } satisfies SimulationRequest);
      } catch (error) {
        pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("billiards: simulation request failed"),
        );
      }
    });
  return {
    ready: () =>
      new Promise<void>((resolve, reject) => {
        if (disposed) {
          reject(new DOMException("Disposed", "AbortError"));
          return;
        }
        const id = nextId++;
        pending.set(id, { resolve: () => resolve(), reject });
        try {
          worker.postMessage({
            id,
            kind: "ready",
          } satisfies SimulationReadyRequest);
        } catch (error) {
          pending.delete(id);
          reject(
            error instanceof Error
              ? error
              : new Error("billiards: simulation request failed"),
          );
        }
      }),
    shot: (balls: readonly BallState[], shot: ShotParams) =>
      request("shot", balls, shot) as Promise<ShotSimResult>,
    preview: (balls: readonly BallState[], shot: ShotParams) =>
      request("preview", balls, shot) as Promise<AimGuide | null>,
    dispose() {
      disposed = true;
      worker.terminate();
      fail(new DOMException("Disposed", "AbortError"));
    },
  };
}
