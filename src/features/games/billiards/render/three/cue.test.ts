import { Box3, type Group, type Mesh, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { createCue } from "./cue";
import { CUE_APPEARANCE } from "./cue-appearance";
import { createResources } from "./resources";

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => null }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("各玩法球杆尺寸与姿态", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 分段首尾连续，锥度平滑且整杆长度吻合`, () => {
      const resources = createResources();
      const cue = createCue(equipment, resources);
      const stick = cue.layer.children[0] as Group;
      const appearance = CUE_APPEARANCE[equipment.id];
      expect(
        new Box3().setFromObject(stick).getSize(new Vector3()).x,
      ).toBeCloseTo(equipment.cueLength, 6);
      let lastEnd = 0;
      let lastRadius = equipment.cueTipDiameter / 2;
      for (const part of stick.children as Mesh[]) {
        const geometry = part.geometry as import("three").CylinderGeometry;
        const { height, radiusBottom, radiusTop, radialSegments } =
          geometry.parameters;
        expect(height).toBeGreaterThan(0);
        expect(part.position.x - height / 2).toBeCloseTo(lastEnd, 10);
        expect(radiusBottom).toBeCloseTo(lastRadius, 10);
        expect(radiusTop).toBeGreaterThanOrEqual(radiusBottom);
        expect(radialSegments).toBeGreaterThanOrEqual(32);
        lastEnd = part.position.x + height / 2;
        lastRadius = radiusTop;
      }
      expect(lastRadius).toBeCloseTo(equipment.cueButtDiameter / 2, 10);
      expect(appearance.bands.at(-1)?.end).toBe(1);
      resources.dispose();
    });

    it(`${equipment.id} 各方向与最大拉杆不穿母球且杆长不跳变`, () => {
      const resources = createResources();
      const cue = createCue(equipment, resources);
      const stick = cue.layer.children[0];
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
        for (const pull of [0, 1]) {
          cue.pose(0.5, 0.3, angle, pull);
          cue.layer.updateMatrixWorld(true);
          const tip = stick.localToWorld(new Vector3(0, 0, 0));
          expect(tip.distanceTo(cue.layer.position)).toBeGreaterThan(
            equipment.ballRadius,
          );
          const tipMesh = stick.children[0] as Mesh;
          const vertices = tipMesh.geometry.getAttribute("position");
          for (let index = 0; index < vertices.count; index++) {
            const surface = tipMesh.localToWorld(
              new Vector3().fromBufferAttribute(vertices, index),
            );
            expect(surface.distanceTo(cue.layer.position)).toBeGreaterThan(
              equipment.ballRadius,
            );
          }
          expect(stick.scale).toEqual(new Vector3(1, 1, 1));
          expect(stick.position.x).toBeCloseTo(
            equipment.ballRadius + 0.005 + pull * 0.28,
          );
        }
      }
      resources.dispose();
    });
  }

  it("三玩法分别保持参考图的前节占比与纤细程度，不共用等比分段", () => {
    expect(
      new Set(Object.values(CUE_APPEARANCE).map((value) => value.shaftEnd))
        .size,
    ).toBe(3);
    expect(
      EQUIPMENT["american-nine"].cueLength /
        EQUIPMENT["american-nine"].tableWidth,
    ).toBeGreaterThan(0.7);
    expect(
      EQUIPMENT.snooker.cueLength / EQUIPMENT.snooker.tableWidth,
    ).toBeGreaterThan(0.77);
    expect(EQUIPMENT.snooker.cueTipDiameter).toBeLessThan(
      EQUIPMENT["american-nine"].cueTipDiameter,
    );
  });
});
