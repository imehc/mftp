import { Vector3 } from "three";
import type { Line2 } from "three/addons/lines/Line2.js";
import { describe, expect, it } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { createTableCamera } from "./camera";
import { createHud } from "./hud";
import { createResources } from "./resources";

describe("任意球圈的相机投影", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 在横竖屏、近库与入场缩放时始终与球心同心`, () => {
      const resources = createResources();
      const hud = createHud(equipment, resources);
      const rig = createTableCamera(equipment);
      const ring = hud.layer.getObjectByName("cue-placement-ring") as Line2;
      for (const [width, height, portrait] of [
        [320, 600, true],
        [390, 600, true],
        [767, 600, true],
        [768, 400, false],
        [1024, 600, false],
        [1440, 600, false],
      ] as const) {
        rig.resize(width, height, portrait);
        hud.resize(width, height);
        for (const entrance of [0, 0.4, 1]) {
          rig.entrance(entrance);
          for (const side of [-1, 0, 1]) {
            const x = side * (equipment.tableWidth / 2 - equipment.ballRadius);
            const z = side * (equipment.tableHeight / 2 - equipment.ballRadius);
            hud.clear();
            hud.placement(x, z, side !== -1);
            hud.layer.updateMatrixWorld(true);
            const starts = ring.geometry.attributes.instanceStart;
            const first = new Vector3()
              .fromBufferAttribute(starts, 0)
              .applyMatrix4(ring.matrixWorld)
              .project(rig.camera);
            const opposite = new Vector3()
              .fromBufferAttribute(starts, 32)
              .applyMatrix4(ring.matrixWorld)
              .project(rig.camera);
            const center = first.add(opposite).multiplyScalar(0.5);
            const ball = new Vector3(x, equipment.ballRadius, z).project(
              rig.camera,
            );
            expect(
              Math.hypot(
                ((center.x - ball.x) * width) / 2,
                ((center.y - ball.y) * height) / 2,
              ),
            ).toBeLessThan(0.01);
            expect(ring.visible).toBe(true);
            expect(ring.material.color.getHex()).toBe(
              side === -1 ? 0xd93025 : 0x9fe8bd,
            );
          }
        }
      }
      hud.clear();
      expect(ring.visible).toBe(false);
      resources.dispose();
    });
  }
});
