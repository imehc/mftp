import { Mesh, MeshPhysicalMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { createNineBallState } from "../../nine-ball";
import { equipmentForState } from "../../placement";
import { createInitialState } from "../../rules";
import { createSnookerState } from "../../snooker";
import { createBallLayer } from "./balls";
import { createTableCamera } from "./camera";
import { createRackIntro } from "./rack-intro";
import { createResources } from "./resources";

vi.mock("./ball-texture", () => ({ buildBallTexture: () => new Texture() }));

describe("摆球入场的临时网格与清理", () => {
  it.each([
    createInitialState("eight-ball"),
    createNineBallState(),
    createInitialState("practice", 0, "nine-ball"),
  ])("推球滚动连续到位且静止球和真实状态不变（$variant）", (state) => {
    const equipment = equipmentForState(state);
    const resources = createResources();
    const balls = createBallLayer(
      equipment,
      state.balls.map((ball) => ball.id),
      false,
      resources,
    );
    balls.sync(state.balls);
    const camera = createTableCamera(equipment);
    camera.resize(1024, 600, false);
    const finalCamera = camera.camera.position.clone();
    const snapshot = structuredClone(state);
    const final = new Map(
      [...balls.meshes].map(([id, mesh]) => [
        id,
        {
          position: mesh.position.clone(),
          orientation: mesh.quaternion.clone(),
        },
      ]),
    );
    const rack = createRackIntro(equipment, balls, camera, resources);
    expect(rack.prepare(state)).toBe(true);
    const frame = rack.layer.children[0] as Mesh;
    const disposeGeometry = vi.spyOn(frame.geometry, "dispose");
    const disposeMaterial = vi.spyOn(
      frame.material as MeshPhysicalMaterial,
      "dispose",
    );
    for (const progress of [0, 0.25, 0.75, 0.25, 0.99999, 1]) {
      rack.update({ push: progress, lift: 0, exit: 0, opacity: 1 });
      for (const [id, mesh] of balls.meshes) {
        const target = final.get(id)!;
        const moving = id !== 0;
        if (!moving || progress === 1) {
          expect(mesh.position.equals(target.position)).toBe(true);
          expect(mesh.quaternion.angleTo(target.orientation)).toBeCloseTo(0);
        } else {
          expect(mesh.position.x).toBeLessThan(target.position.x);
          expect(mesh.position.y).toBe(equipment.ballRadius);
          if (progress === 0.99999)
            expect(mesh.quaternion.angleTo(target.orientation)).toBeLessThan(
              0.0001,
            );
        }
      }
    }
    rack.update({ push: 1, lift: 1, exit: 0, opacity: 1 });
    expect(frame.position.y).toBeGreaterThan(equipment.ballRadius * 2);
    expect(frame.position.x).toBe(0);
    rack.update({ push: 1, lift: 1, exit: 1, opacity: 0 });
    expect(frame.position.x).toBeGreaterThan(0);
    expect(rack.layer.visible).toBe(false);
    rack.finish();
    rack.finish();
    expect(rack.active).toBe(false);
    expect(rack.layer.children).toHaveLength(0);
    expect(camera.camera.position.equals(finalCamera)).toBe(true);
    expect(state).toEqual(snapshot);
    resources.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  });

  it("推球中取消恢复终态且清理后迟到进度不再移动球", () => {
    const state = createNineBallState();
    const resources = createResources();
    const balls = createBallLayer(
      EQUIPMENT["american-nine"],
      state.balls.map((ball) => ball.id),
      false,
      resources,
    );
    balls.sync(state.balls);
    const rack = createRackIntro(
      EQUIPMENT["american-nine"],
      balls,
      createTableCamera(EQUIPMENT["american-nine"]),
      resources,
    );
    rack.prepare(state);
    rack.update({ push: 0.3, lift: 0, exit: 0, opacity: 1 });
    rack.finish();
    rack.update({ push: 0.1, lift: 0, exit: 0, opacity: 1 });
    for (const ball of state.balls) {
      expect(balls.meshes.get(ball.id)!.position.x).toBe(ball.x);
      expect(balls.meshes.get(ball.id)!.position.z).toBe(ball.y);
    }
    resources.dispose();
  });

  it.each([6, 10, 15] as const)(
    "斯诺克 %s 红及练习局不创建球框、不移动任何球",
    (reds) => {
      for (const state of [
        createSnookerState(reds),
        createInitialState("practice", 0, "snooker", 1, reds),
      ]) {
        const resources = createResources();
        const balls = createBallLayer(
          EQUIPMENT.snooker,
          state.balls.map((ball) => ball.id),
          false,
          resources,
        );
        balls.sync(state.balls);
        const rack = createRackIntro(
          EQUIPMENT.snooker,
          balls,
          createTableCamera(EQUIPMENT.snooker),
          resources,
        );
        expect(rack.prepare(state)).toBe(false);
        rack.update({ push: 0.5, lift: 0.5, exit: 0, opacity: 1 });
        rack.finish();
        expect(rack.layer.children).toHaveLength(0);
        for (const ball of state.balls) {
          const mesh = balls.meshes.get(ball.id)!;
          expect(mesh.position.x).toBe(ball.x);
          expect(mesh.position.z).toBe(ball.y);
          expect(mesh.visible).toBe(true);
          expect(mesh.material.transparent).toBe(false);
        }
        resources.dispose();
      }
    },
  );
});
