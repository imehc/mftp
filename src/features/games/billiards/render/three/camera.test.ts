import {
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { tableLayout } from "../layout";
import type { CameraFocus } from "./camera";
import { createTableCamera } from "./camera";

const focus: CameraFocus = {
  x: 0.8,
  z: 0,
  halfWidth: 0.45,
  halfHeight: 0.35,
  ceiling: 0.3,
};

const viewports = [
  [320, 600, true],
  [390, 600, true],
  [767, 600, true],
  [768, 400, false],
  [1024, 600, false],
  [1440, 600, false],
  [844, 240, false],
] as const;

describe("台球正俯视与摆球近景取景", () => {
  it("斯诺克采用正交投影，左右及顶库球的轮廓均保持等宽高", () => {
    const equipment = EQUIPMENT.snooker;
    const rig = createTableCamera(equipment);
    expect(rig.camera).toBeInstanceOf(OrthographicCamera);
    expect(createTableCamera(EQUIPMENT["chinese-eight"]).camera).toBeInstanceOf(
      PerspectiveCamera,
    );
    const geometry = new SphereGeometry(equipment.ballRadius, 128, 96);
    const vertices = geometry.getAttribute("position");
    for (const [width, height, portrait] of viewports) {
      rig.resize(width, height, portrait);
      for (const horizontal of [-0.85, 0, 0.85]) {
        const x = (horizontal * equipment.tableWidth) / 2;
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        const point = new Vector3();
        for (let index = 0; index < vertices.count; index++) {
          point
            .fromBufferAttribute(vertices, index)
            .add(new Vector3(x, equipment.ballRadius, 0))
            .project(rig.camera);
          const screenX = (point.x * width) / 2;
          const screenY = (point.y * height) / 2;
          left = Math.min(left, screenX);
          right = Math.max(right, screenX);
          top = Math.min(top, screenY);
          bottom = Math.max(bottom, screenY);
        }
        expect((right - left) / (bottom - top)).toBeCloseTo(1, 3);
      }
    }
    geometry.dispose();
  });

  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 在横竖窄屏最终完整包含外框角点`, () => {
      const rig = createTableCamera(equipment);
      const { OUTER_W, OUTER_H } = tableLayout(equipment);
      for (const [width, height, portrait] of viewports) {
        rig.resize(width, height, portrait);
        {
          rig.focus(focus);
          rig.entrance(0);
          for (const x of [-OUTER_W - 0.015, OUTER_W + 0.015]) {
            for (const z of [-OUTER_H - 0.015, OUTER_H + 0.015]) {
              for (const y of [-0.1, 0.06]) {
                const projected = new Vector3(x, y, z).project(rig.camera);
                expect(Math.abs(projected.x)).toBeLessThan(1);
                expect(Math.abs(projected.y)).toBeLessThan(1);
                expect(Math.abs(projected.z)).toBeLessThan(1);
              }
            }
          }
        }
      }
    });

    it(`${equipment.id} 收尾严格垂直台面并保持开球方向`, () => {
      const rig = createTableCamera(equipment);
      for (const [width, height, portrait] of viewports) {
        rig.resize(width, height, portrait);
        rig.entrance(1);
        rig.entrance(0);
        const direction = rig.camera.getWorldDirection(new Vector3());
        expect(direction.x).toBeCloseTo(0, 12);
        expect(direction.y).toBeCloseTo(-1, 12);
        expect(direction.z).toBeCloseTo(0, 12);
        expect(rig.camera.position.x).toBeCloseTo(0, 12);
        expect(rig.camera.position.z).toBeCloseTo(0, 12);
        const head = new Vector3(-equipment.tableWidth / 4, 0, 0).project(
          rig.camera,
        );
        expect(portrait ? head.y : head.x).toBeLessThan(0);
        expect(portrait ? head.x : head.y).toBeCloseTo(0, 12);
      }
    });

    it(`${equipment.id} 入场中调整尺寸不会重置镜头进度`, () => {
      const resized = createTableCamera(equipment);
      resized.focus(focus);
      resized.resize(1440, 600, false);
      resized.entrance(0.43);
      for (const [width, height, portrait] of viewports) {
        resized.resize(width, height, portrait);
        const expected = createTableCamera(equipment);
        expected.focus(focus);
        expected.resize(width, height, portrait);
        expected.entrance(0.43);
        expect(
          resized.camera.position.distanceTo(expected.camera.position),
        ).toBe(0);
        expect(
          resized.camera.quaternion.angleTo(expected.camera.quaternion),
        ).toBeCloseTo(0, 7);
      }
    });

    it(`${equipment.id} 各入场进度下投影与台面求交一致`, () => {
      const rig = createTableCamera(equipment);
      rig.focus(focus);
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      const ray = new Raycaster();
      for (const [width, height, portrait] of viewports) {
        rig.resize(width, height, portrait);
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          rig.entrance(progress);
          for (const x of [
            -equipment.tableWidth / 3,
            0,
            equipment.tableWidth / 3,
          ]) {
            for (const z of [
              -equipment.tableHeight / 3,
              0,
              equipment.tableHeight / 3,
            ]) {
              const point = new Vector3(x, 0, z);
              const projected = point.clone().project(rig.camera);
              ray.setFromCamera(
                new Vector2(projected.x, projected.y),
                rig.camera,
              );
              const hit = ray.ray.intersectPlane(plane, new Vector3());
              expect(hit?.distanceTo(point)).toBeCloseTo(0, 10);
            }
          }
        }
      }
    });
  }

  it("近景全程不旋转或倾斜，连续拉远至原全桌取景", () => {
    const rig = createTableCamera(EQUIPMENT["chinese-eight"]);
    for (const [width, height, portrait] of viewports) {
      rig.resize(width, height, portrait);
      rig.focus(focus);
      rig.entrance(0);
      const finalDistance = rig.camera.position.y;
      const orientation = rig.camera.quaternion.clone();
      rig.entrance(1);
      expect(rig.camera.position.y).toBeLessThan(finalDistance);
      let previousDistance = rig.camera.position.y;
      for (let step = 40; step >= 0; step--) {
        rig.entrance(step / 40);
        expect(rig.camera.position.x).toBeCloseTo(focus.x * (step / 40));
        expect(rig.camera.position.z).toBe(0);
        expect(rig.camera.quaternion.angleTo(orientation)).toBeCloseTo(0, 7);
        expect(rig.camera.position.y).toBeGreaterThanOrEqual(
          previousDistance - 1e-12,
        );
        expect(rig.camera.position.y).toBeLessThanOrEqual(finalDistance);
        previousDistance = rig.camera.position.y;
      }
    }
  });

  it("各投影和方向的近景包含球框包围范围", () => {
    for (const equipment of Object.values(EQUIPMENT)) {
      const rig = createTableCamera(equipment);
      rig.focus(focus);
      rig.entrance(1);
      for (const [width, height, portrait] of viewports) {
        rig.resize(width, height, portrait);
        for (const horizontal of [-1, 1])
          for (const vertical of [-1, 1]) {
            const corner = new Vector3(
              focus.x + horizontal * focus.halfWidth,
              focus.ceiling,
              vertical * focus.halfHeight,
            ).project(rig.camera);
            expect(Math.abs(corner.x)).toBeLessThan(1);
            expect(Math.abs(corner.y)).toBeLessThan(1);
          }
      }
    }
  });
});
