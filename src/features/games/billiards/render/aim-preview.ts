import { createSimulationClient } from "../simulation-client";
import type { BallState } from "../types";
import type { AimGuide } from "./guides";

/** 合并连续输入；同一球局保留最近计算结果，避免异步等待造成闪烁。 */
export function createAimPreview(onUpdate: () => void) {
  const client = createSimulationClient();
  let current: {
    balls: readonly BallState[];
    angle: number;
    power: number;
    followDraw: number;
  } | null = null;
  let guide: AimGuide | null = null;
  let busy = false;
  let disposed = false;

  const run = async () => {
    if (busy || !current || disposed) return;
    busy = true;
    const input = current;
    try {
      const result = await client.preview(input.balls, input);
      if (!disposed && current?.balls === input.balls) {
        // 连续拖动也要发布已完成结果，否则输入快于 worker 时始终没有指示线。
        guide = result;
        onUpdate();
      }
    } catch {
      // 预览失败不能自动重放击球或继续展示过期轨迹。
      if (!disposed && current === input) {
        guide = null;
        onUpdate();
      }
    } finally {
      busy = false;
      if (current !== input) void run();
    }
  };

  return {
    get(
      balls: readonly BallState[],
      angle: number,
      power: number,
      followDraw: number,
    ) {
      if (
        !current ||
        current.balls !== balls ||
        current.angle !== angle ||
        current.power !== power ||
        current.followDraw !== followDraw
      ) {
        // 球的位置变化才使旧轨迹失效；角度/力度变化不先插入一帧空白。
        if (current?.balls !== balls) guide = null;
        current = { balls, angle, power, followDraw };
        void run();
      }
      return guide;
    },
    dispose() {
      disposed = true;
      client.dispose();
    },
  };
}
