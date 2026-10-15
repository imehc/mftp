import { Box3, type Group, Line3, type Mesh, Vector3 } from "three";
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
          expect(stick.position.length()).toBeCloseTo(
            equipment.ballRadius + 0.005 + pull * 0.28,
          );
        }
      }
      resources.dispose();
    });

    it(`${equipment.id} 杆后近球在瞄准、拉杆与随挥时均不穿杆`, () => {
      const resources = createResources();
      const cue = createCue(equipment, resources);
      const stick = cue.layer.children[0];
      const distance = equipment.ballRadius * 2 + 0.002;
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
        const obstacle = {
          id: 1,
          x: -Math.cos(angle) * distance,
          y: -Math.sin(angle) * distance,
          potted: false,
        };
        let elevation: number | undefined;
        for (const pull of [0, 0.5, 1, -0.018, -0.16]) {
          cue.pose(0, 0, angle, pull, [obstacle]);
          elevation ??= stick.rotation.z;
          expect(stick.rotation.z).toBe(elevation);
          cue.layer.updateMatrixWorld(true);
          const center = new Vector3(
            obstacle.x,
            equipment.ballRadius,
            obstacle.y,
          );
          for (const part of stick.children as Mesh[]) {
            const geometry = part.geometry as import("three").CylinderGeometry;
            const { height, radiusTop } = geometry.parameters;
            const axis = new Line3(
              part.localToWorld(new Vector3(0, -height / 2, 0)),
              part.localToWorld(new Vector3(0, height / 2, 0)),
            );
            const nearest = axis.closestPointToPoint(
              center,
              true,
              new Vector3(),
            );
            expect(nearest.distanceTo(center)).toBeGreaterThan(
              equipment.ballRadius + radiusTop,
            );
          }
        }
      }
      resources.dispose();
    });

    it(`${equipment.id} 母球贴库时整段球杆高于库边和木框`, () => {
      const resources = createResources();
      const cue = createCue(equipment, resources);
      const stick = cue.layer.children[0];
      const halfWidth = equipment.tableWidth / 2;
      const halfHeight = equipment.tableHeight / 2;
      const border = equipment.cushionWidth + equipment.frameWidth;
      const frames = [
        [
          -halfWidth - border,
          -halfHeight - border,
          -halfWidth,
          halfHeight + border,
        ],
        [
          halfWidth,
          -halfHeight - border,
          halfWidth + border,
          halfHeight + border,
        ],
        [
          -halfWidth - border,
          -halfHeight - border,
          halfWidth + border,
          -halfHeight,
        ],
        [
          -halfWidth - border,
          halfHeight,
          halfWidth + border,
          halfHeight + border,
        ],
      ].map(
        ([minX, minZ, maxX, maxZ]) =>
          new Box3(
            new Vector3(minX, -0.065, minZ),
            new Vector3(maxX, equipment.cushionHeight + 0.002, maxZ),
          ),
      );
      const nearX = halfWidth - equipment.ballRadius;
      const nearZ = halfHeight - equipment.ballRadius;
      for (const [x, z, angle] of [
        [nearX, 0, Math.PI],
        [-nearX, 0, 0],
        [0, nearZ, -Math.PI / 2],
        [0, -nearZ, Math.PI / 2],
        [nearX, nearZ, (-Math.PI * 3) / 4],
        [-nearX, -nearZ, Math.PI / 4],
      ]) {
        for (const pull of [0, 0.5, 1, -0.018, -0.16]) {
          cue.pose(x, z, angle, pull);
          cue.layer.updateMatrixWorld(true);
          for (const part of stick.children as Mesh[]) {
            const geometry = part.geometry as import("three").CylinderGeometry;
            const { height, radiusTop } = geometry.parameters;
            for (let step = 0; step <= 100; step++) {
              const point = part.localToWorld(
                new Vector3(0, height * (step / 100 - 0.5), 0),
              );
              for (const frame of frames)
                expect(frame.distanceToPoint(point)).toBeGreaterThan(radiusTop);
            }
          }
        }
      }
      resources.dispose();
    });

    it(`${equipment.id} 无遮挡或障碍已落袋时保持默认低杆姿态`, () => {
      const resources = createResources();
      const cue = createCue(equipment, resources);
      const stick = cue.layer.children[0];
      for (const balls of [
        [],
        [{ id: 1, x: -equipment.ballRadius * 2, y: 0, potted: true }],
        [{ id: 1, x: -0.1, y: 0.2, potted: false }],
        [{ id: 1, x: 0.1, y: 0, potted: false }],
      ]) {
        cue.pose(0, 0, 0, 0, balls);
        expect(stick.rotation.z).toBe(Math.PI / 30);
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
