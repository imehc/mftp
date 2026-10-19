import { beforeAll, describe, expect, it } from "vitest";

import { insidePlayArea } from "./ball-geometry";
import { EQUIPMENT, SNOOKER } from "./equipment";
import { ensurePhysicsReady, simulateShot } from "./physics";
import {
  getPocketGeometries,
  insidePolygon,
  pocketAt,
  pocketLocal,
  pocketRayDistance,
  pocketWorld,
} from "./pocket-geometry";

beforeAll(ensurePhysicsReady);

describe("可见袋孔的低速落袋", () => {
  for (const pocket of getPocketGeometries(SNOOKER).filter(
    (entry) => entry.spec.kind === "side",
  )) {
    it(`斯诺克第 ${pocket.spec.id + 1} 袋的轻球不会停在黑洞内`, () => {
      const start = pocketWorld(pocket.spec, 0, -0.2);
      expect(insidePlayArea(start.x, start.y, SNOOKER)).toBe(true);
      for (const power of [0.043, 0.044]) {
        const result = simulateShot(
          [{ id: 0, ...start, potted: false }],
          {
            angle: Math.atan2(pocket.spec.dy, pocket.spec.dx),
            power,
            followDraw: 0,
          },
          false,
          SNOOKER,
        );
        expect(result.cuePotted).toBe(true);
        expect(result.facts.rails).toHaveLength(0);
        const event = result.events.find((entry) => entry.type === "pocket");
        expect(event).toMatchObject({ ball: 0, pocket: pocket.spec.id });
        if (event?.type !== "pocket") throw new Error("missing pocket event");
        const local = pocketLocal(pocket.spec, event);
        expect(insidePolygon(local, pocket.openingLocal)).toBe(true);
        expect(local.y - pocket.front).toBeLessThan(0.001);
      }
    });
  }

  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 的六袋低速与高速正向入射均在可见孔内落袋`, () => {
      for (const pocket of getPocketGeometries(equipment)) {
        const start = pocketWorld(pocket.spec, 0, pocket.front - 0.2);
        for (const power of [0.042, 0.25, 1]) {
          const result = simulateShot(
            [{ id: 0, ...start, potted: false }],
            {
              angle: Math.atan2(pocket.spec.dy, pocket.spec.dx),
              power,
              followDraw: 0,
            },
            false,
            equipment,
          );
          expect(result.cuePotted).toBe(true);
          const event = result.events.find((entry) => entry.type === "pocket");
          expect(event).toMatchObject({ pocket: pocket.spec.id });
          if (event?.type !== "pocket") throw new Error("missing pocket event");
          expect(pocketAt(event, equipment)?.id).toBe(pocket.spec.id);
        }
      }
    });

    it(`${equipment.id} 的中袋不会吸入仅球边覆盖圆孔的球`, () => {
      for (const pocket of getPocketGeometries(equipment).filter(
        (entry) => entry.spec.kind === "side",
      )) {
        const depth = pocket.front - 0.003;
        const start = pocketWorld(pocket.spec, -0.03, depth);
        const result = simulateShot(
          [{ id: 0, ...start, potted: false }],
          {
            angle: Math.atan2(pocket.spec.dx, -pocket.spec.dy),
            power: 0.02,
            followDraw: 0,
          },
          false,
          equipment,
        );
        expect(result.cuePotted).toBe(false);
        expect(pocketAt(result.balls[0], equipment)).toBeUndefined();
      }
    });

    it(`${equipment.id} 的辅助线沿圆孔边缘截断，支持斜向和横向入射`, () => {
      for (const pocket of getPocketGeometries(equipment)) {
        for (const lateral of [0, 0.35, -0.35, 1]) {
          const outward = Math.sqrt(1 - lateral ** 2);
          const center = pocketWorld(pocket.spec, 0, pocket.cavityDepth);
          const direction = {
            x: -pocket.spec.dy * lateral + pocket.spec.dx * outward,
            y: pocket.spec.dx * lateral + pocket.spec.dy * outward,
          };
          const origin = {
            x: center.x - direction.x * 0.3,
            y: center.y - direction.y * 0.3,
          };
          const distance = pocketRayDistance(origin, direction, 0.5, equipment);
          const before = {
            x: origin.x + direction.x * (distance - 0.00001),
            y: origin.y + direction.y * (distance - 0.00001),
          };
          const after = {
            x: origin.x + direction.x * (distance + 0.00001),
            y: origin.y + direction.y * (distance + 0.00001),
          };
          expect(distance).toBeCloseTo(0.3 - pocket.cavityRadius, 4);
          expect(pocketAt(before, equipment)).toBeUndefined();
          expect(pocketAt(after, equipment)?.id).toBe(pocket.spec.id);
          expect(pocketRayDistance(center, direction, 0.5, equipment)).toBe(0);
          expect(pocketRayDistance(origin, direction, 0.01, equipment)).toBe(
            0.01,
          );
        }
      }
    });

    it(`${equipment.id} 的辅助线掠过孔外或背向开孔时不截断`, () => {
      for (const pocket of getPocketGeometries(equipment)) {
        const origin = pocketWorld(pocket.spec, 0, pocket.front - 0.001);
        for (const direction of [
          { x: -pocket.spec.dy, y: pocket.spec.dx },
          { x: -pocket.spec.dx, y: -pocket.spec.dy },
        ])
          expect(pocketRayDistance(origin, direction, 0.2, equipment)).toBe(
            0.2,
          );
      }
    });
  }
});
