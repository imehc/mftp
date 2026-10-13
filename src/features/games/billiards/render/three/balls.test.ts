import { Texture, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { CHINESE_EIGHT, SNOOKER } from "../../equipment";
import { getPocketGeometries, pocketWorld } from "../../pocket-geometry";
import { createBallLayer } from "./balls";
import { createResources } from "./resources";

vi.mock("./ball-texture", () => ({ buildBallTexture: () => new Texture() }));

describe("球网格滚动与落袋生命周期", () => {
  it("一周无滑动滚动恢复朝向，位置同步不额外滚动", () => {
    const resources = createResources();
    const balls = createBallLayer(CHINESE_EIGHT, [0], false, resources);
    balls.sync([{ id: 0, x: 0, y: 0, potted: false }]);
    const ball = balls.meshes.get(0)!;
    const orientation = ball.quaternion.clone();
    balls.move(0, Math.PI * 2 * CHINESE_EIGHT.ballRadius, 0, true);
    expect(ball.quaternion.angleTo(orientation)).toBeCloseTo(0);
    balls.move(0, 0, 0, false);
    expect(ball.quaternion.angleTo(orientation)).toBeCloseTo(0);
    balls.move(0, (Math.PI / 2) * CHINESE_EIGHT.ballRadius, 0, true);
    expect(ball.quaternion.angleTo(orientation)).toBeCloseTo(Math.PI / 2);
    resources.dispose();
  });

  it("红球共享静态材质，单球下沉不会淡出其余红球", () => {
    const resources = createResources();
    const balls = createBallLayer(SNOOKER, [101, 102], false, resources);
    const pocket = getPocketGeometries(SNOOKER)[0];
    const p = pocketWorld(pocket.spec, 0, pocket.supportDepth);
    balls.sync([
      { id: 101, ...p, potted: false },
      { id: 102, x: 0, y: 0, potted: false },
    ]);
    const first = balls.meshes.get(101)!;
    const second = balls.meshes.get(102)!;
    const material = first.material;
    expect(second.material).toBe(material);
    balls.maskPocket(101, pocket.spec.id);
    const view = balls.view(101)!;
    view.sink?.(0.8, {
      type: "pocket",
      t: 0,
      ball: 101,
      pocket: pocket.spec.id,
      ...p,
      vx: pocket.spec.dx,
      vy: pocket.spec.dy,
    });
    view.alpha = 0.5;
    expect(first.position.y).toBeLessThan(SNOOKER.ballRadius);
    expect(first.scale.equals(new Vector3(1, 1, 1))).toBe(true);
    expect(second.material.opacity).toBe(1);
    expect(first.material).not.toBe(material);
    balls.sync([{ id: 101, x: 0, y: 0, potted: false }]);
    expect(first.material).toBe(material);
    expect(first.position.y).toBe(SNOOKER.ballRadius);
    resources.dispose();
  });
});
