import { describe, expect, it } from "vitest";

import { EQUIPMENT } from "../../equipment";
import {
  getPocketGeometries,
  pocketLocal,
  pocketShelfHeight,
  pocketWorld,
} from "../../pocket-geometry";
import { pocketDropPosition, type PocketEvent } from "./pocket-drop";

describe("后移袋孔的台呢入口与下沉衔接", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 的六袋均先经过石板入口再在袋孔下沉`, () => {
      for (const pocket of getPocketGeometries(equipment)) {
        const start = pocketWorld(
          pocket.spec,
          0.005,
          pocket.supportDepth + 0.0001,
        );
        const event: PocketEvent = {
          type: "pocket",
          t: 0,
          ball: 0,
          pocket: pocket.spec.id,
          ...start,
          vx: pocket.spec.dx,
          vy: pocket.spec.dy,
        };
        const initial = pocketDropPosition(equipment, pocket, event, 0);
        expect(initial.x).toBeCloseTo(start.x, 10);
        expect(initial.z).toBeCloseTo(start.y, 10);
        let previousDepth = pocket.supportDepth;
        for (let step = 0; step <= 58; step++) {
          const position = pocketDropPosition(
            equipment,
            pocket,
            event,
            step / 100,
          );
          const local = pocketLocal(pocket.spec, {
            x: position.x,
            y: position.z,
          });
          expect(local.y).toBeGreaterThanOrEqual(previousDepth - 1e-9);
          expect(position.y).toBeCloseTo(
            equipment.ballRadius + pocketShelfHeight(pocket, local.y),
            8,
          );
          expect(position.alpha).toBe(1);
          previousDepth = local.y;
        }
        const center = pocketWorld(pocket.spec, 0, pocket.cavityDepth);
        for (const progress of [0.6, 0.8, 1]) {
          const position = pocketDropPosition(
            equipment,
            pocket,
            event,
            progress,
          );
          expect(position.x).toBeCloseTo(center.x, 8);
          expect(position.z).toBeCloseTo(center.y, 8);
        }
        const dropped = pocketDropPosition(equipment, pocket, event, 1);
        expect(dropped.y).toBeLessThan(-0.14);
        expect(dropped.alpha).toBe(0);
      }
    });
  }
});
