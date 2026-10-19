import { EQUIPMENT } from "./equipment";
import { ensurePhysicsReady, simulateShot } from "./physics";
import { computeAimGuide } from "./render/guides";
import type {
  SimulationReadyRequest,
  SimulationRequest,
  SimulationResponse,
} from "./simulation-client";

self.onmessage = async ({
  data,
}: MessageEvent<SimulationRequest | SimulationReadyRequest>) => {
  try {
    await ensurePhysicsReady();
    if (data.kind === "ready") {
      self.postMessage({
        id: data.id,
        result: null,
      } satisfies SimulationResponse);
      return;
    }
    const { shot, balls } = data;
    const equipment = EQUIPMENT[data.equipmentId];
    if (!equipment) throw new Error("billiards: unknown equipment");
    const result =
      data.kind === "shot"
        ? simulateShot(balls, shot, false, equipment)
        : computeAimGuide(
            balls,
            shot.angle,
            shot.followDraw,
            shot.power,
            equipment,
          );
    self.postMessage({ id: data.id, result } satisfies SimulationResponse);
  } catch {
    self.postMessage({
      id: data.id,
      error: "billiards: simulation failed",
    } satisfies SimulationResponse);
  }
};
