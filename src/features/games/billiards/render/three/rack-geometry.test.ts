import { Vector2 } from "three";
import { describe, expect, it } from "vitest";

import { SNOOKER } from "../../equipment";
import { createNineBallState } from "../../nine-ball";
import { equipmentForState } from "../../placement";
import { createInitialState } from "../../rules";
import { createSnookerState } from "../../snooker";
import { rackBallPositions, rackGeometry, rackLayout } from "./rack-geometry";

const fixtures = [
  createInitialState("eight-ball"),
  createNineBallState(),
  createInitialState("practice", 0, "nine-ball"),
];

describe("入场球框与临时摆球", () => {
  for (const state of fixtures) {
    const equipment = equipmentForState(state);

    it(`${state.variant} ${equipment.id} ${state.balls.length} 球的框内沿不穿球且推动不改变开局状态`, () => {
      const snapshot = structuredClone(state);
      const layout = rackLayout(equipment, state)!;
      expect(layout.pushDistance).toBeGreaterThan(equipment.ballRadius);
      for (const ball of layout.balls) {
        const center = new Vector2(ball.x, ball.y);
        for (const [index, point] of layout.inner.entries()) {
          const next = layout.inner[(index + 1) % layout.inner.length];
          const edge = next.clone().sub(point);
          const distance =
            Math.abs(edge.cross(center.clone().sub(point))) / edge.length();
          expect(distance).toBeGreaterThan(equipment.ballRadius);
        }
      }
      const selected = new Set(layout.balls.map((ball) => ball.id));
      const fixed = state.balls.filter((ball) => !selected.has(ball.id));
      for (let step = 0; step <= 20; step++) {
        for (const point of layout.outer) {
          for (const other of fixed) {
            expect(
              Math.hypot(
                point.x - layout.pushDistance * (1 - step / 20) - other.x,
                point.y - other.y,
              ),
            ).toBeGreaterThan(equipment.ballRadius * 1.03);
          }
        }
        for (const ball of rackBallPositions(layout, step / 20)) {
          expect(ball.x + equipment.ballRadius).toBeLessThan(
            equipment.tableWidth / 2,
          );
          expect(ball.x - equipment.ballRadius).toBeGreaterThan(
            -equipment.tableWidth / 2,
          );
          for (const other of fixed) {
            expect(
              Math.hypot(ball.x - other.x, ball.y - other.y),
            ).toBeGreaterThanOrEqual(equipment.ballRadius * 2 - 1e-9);
          }
        }
      }
      expect(rackBallPositions(layout, 0)[0].x).toBeLessThan(layout.balls[0].x);
      expect(rackBallPositions(layout, 0.5)[0].x).toBeGreaterThan(
        rackBallPositions(layout, 0)[0].x,
      );
      expect(rackBallPositions(layout, 1)).toEqual(layout.balls);
      expect(state).toEqual(snapshot);
      const geometry = rackGeometry(layout);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBeGreaterThan(0);
      expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      geometry.dispose();
    });
  }

  it("不对已经散开的无有效球堆局面创建球框", () => {
    const state = createNineBallState();
    expect(
      rackLayout(equipmentForState(state), {
        ...state,
        balls: state.balls.filter((ball) => ball.id < 3),
      }),
    ).toBeNull();
  });

  it.each([6, 10, 15] as const)("斯诺克 %s 红不生成入场球框几何", (reds) => {
    expect(rackLayout(SNOOKER, createSnookerState(reds))).toBeNull();
    expect(
      rackLayout(
        SNOOKER,
        createInitialState("practice", 0, "snooker", 1, reds),
      ),
    ).toBeNull();
  });
});
