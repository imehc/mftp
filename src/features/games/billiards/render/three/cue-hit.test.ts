import { Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { createTableCamera } from "./camera";
import { createCue } from "./cue";
import { createResources } from "./resources";

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => null }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("球杆跨区投影命中", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 横竖屏、抬杆与后拉都能命中真实杆身`, () => {
      const resources = createResources();
      const cue = createCue(equipment, resources);
      const stick = cue.layer.children[0];
      const rig = createTableCamera(equipment);
      for (const portrait of [false, true]) {
        const bounds = {
          left: 92,
          top: 130,
          width: portrait ? 390 : 900,
          height: 600,
        };
        rig.resize(bounds.width, bounds.height, portrait);
        for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
          for (const pull of [0, 1]) {
            cue.pose(-equipment.tableWidth * 0.35, 0, angle, pull);
            stick.updateWorldMatrix(true, false);
            const tip = stick.localToWorld(new Vector3()).project(rig.camera);
            const butt = stick
              .localToWorld(new Vector3(equipment.cueLength, 0, 0))
              .project(rig.camera);
            const dx = (butt.x - tip.x) * bounds.width;
            const dy = (tip.y - butt.y) * bounds.height;
            const distance = Math.hypot(dx, dy);
            for (const part of [0.1, 0.5, 0.9]) {
              const point = stick
                .localToWorld(new Vector3(equipment.cueLength * part, 0, 0))
                .project(rig.camera);
              const event = {
                clientX: bounds.left + ((point.x + 1) * bounds.width) / 2,
                clientY: bounds.top + ((1 - point.y) * bounds.height) / 2,
                pointerType: "mouse",
              };
              expect(cue.hitTest(event, rig.camera, bounds)).toBe(true);
              const near = {
                ...event,
                clientX: event.clientX - (dy / distance) * 16,
                clientY: event.clientY + (dx / distance) * 16,
              };
              expect(cue.hitTest(near, rig.camera, bounds)).toBe(false);
              expect(
                cue.hitTest(
                  { ...near, pointerType: "touch" },
                  rig.camera,
                  bounds,
                ),
              ).toBe(true);
            }
          }
        }
      }
      resources.dispose();
    });
  }
});
