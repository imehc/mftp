import gsap from "gsap";
import { Mesh, MeshPhysicalMaterial, SphereGeometry, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";

import { SNOOKER } from "../../equipment";
import { createSnookerState } from "../../snooker";
import type { BallSelectionView } from "../scene-contract";
import { createBallSelection } from "./ball-selection";
import { createTableCamera } from "./camera";
import { createResources } from "./resources";

const cleanups: (() => void)[] = [];

function finish() {
  for (const animation of gsap.globalTimeline.getChildren(false, true, true))
    animation.totalProgress(1);
}

function fixture(reduced = false, portrait = false) {
  const state = {
    ...createSnookerState(6),
    on: { kind: "color" as const, nominated: null },
    placementRegion: null,
  };
  const resources = createResources();
  const geometry = resources.own(
    new SphereGeometry(SNOOKER.ballRadius, 64, 48),
  );
  const meshes = new Map(
    state.balls.map((ball) => {
      const mesh = new Mesh(
        geometry,
        resources.own(new MeshPhysicalMaterial()),
      );
      mesh.position.set(ball.x, SNOOKER.ballRadius, ball.y);
      mesh.visible = !ball.potted;
      return [ball.id, mesh];
    }),
  );
  const camera = createTableCamera(SNOOKER);
  const width = portrait ? 320 : 1440;
  const height = portrait ? 680 : 800;
  camera.resize(width, height, portrait);
  const views: (BallSelectionView | null)[] = [];
  const selected: number[] = [];
  let angle = 0;
  const controller = createBallSelection({
    ballLayer: { meshes },
    camera,
    equipment: SNOOKER,
    resources,
    touch: portrait,
    reduced,
    redraw() {},
    getAngle: () => angle,
    setAngle: (next) => {
      angle = next;
    },
    callbacks: {
      onSelectionView: (view) => views.push(view),
      onSelectedBall: (id) => selected.push(id),
      onPowerPreview() {},
      onShot: () => true,
      onPlaceCue() {},
      onReady() {},
      onError(error) {
        throw error;
      },
    },
  });
  controller.resize(width, height);
  cleanups.push(() => {
    controller.dispose();
    resources.dispose();
  });
  return {
    state,
    meshes,
    controller,
    views,
    selected,
    camera,
    width,
    height,
    getAngle: () => angle,
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  gsap.globalTimeline.clear();
});

describe("球桌悬浮选球生命周期", () => {
  it("只移动预览，原球坐标、半径、可见性和状态在全过程保持不变", () => {
    const { state, meshes, controller } = fixture();
    const snapshot = JSON.stringify(state);
    const positions = [...meshes.values()].map((mesh) =>
      mesh.position.toArray(),
    );
    controller.set({ ids: [2, 3, 4, 5, 6, 7], selectedId: null }, state);
    finish();
    controller.preview(5);
    controller.select(5);
    finish();
    expect(JSON.stringify(state)).toBe(snapshot);
    expect([...meshes.values()].map((mesh) => mesh.position.toArray())).toEqual(
      positions,
    );
    expect(
      [...meshes.values()].every((mesh) =>
        mesh.scale.equals(new Vector3(1, 1, 1)),
      ),
    ).toBe(true);
    expect([...meshes.values()].every((mesh) => mesh.visible)).toBe(true);
  });

  it.each([false, true])(
    "横竖相机下悬浮预览中心与命中圈投影一致：%s",
    (portrait) => {
      const { state, controller, views, camera, width, height } = fixture(
        false,
        portrait,
      );
      controller.set({ ids: [2, 3, 4, 5, 6, 7], selectedId: null }, state);
      finish();
      expect(views.at(-1)?.phase).toBe("selecting");
      for (const option of views.at(-1)!.options) {
        const mesh = controller.layer.getObjectByName(
          `selection-preview-${option.id}`,
        )!;
        const projection = mesh.position.clone().project(camera.camera);
        expect(((projection.x + 1) * width) / 2).toBeCloseTo(option.x, 2);
        expect(((1 - projection.y) * height) / 2).toBeCloseTo(option.y, 2);
        expect(
          mesh.position.y - SNOOKER.ballRadius * mesh.scale.x,
        ).toBeGreaterThan(SNOOKER.ballRadius);
        expect(mesh.scale.x).toBeCloseTo(mesh.scale.y);
        expect(mesh.scale.x).toBeCloseTo(mesh.scale.z);
      }
    },
  );

  it("点击锁定一次，完成退出前不提交，重复点击不会二次提交", () => {
    const { state, controller, selected } = fixture();
    controller.set({ ids: [2, 3, 4, 5, 6, 7], selectedId: null }, state);
    finish();
    controller.select(5);
    controller.select(7);
    expect(selected).toEqual([]);
    finish();
    expect(selected).toEqual([5]);
    expect(controller.active).toBe(false);
    expect(controller.layer.children.every((mesh) => !mesh.visible)).toBe(true);
  });

  it("取消和回合变化不提交，销毁清理波纹与转场", () => {
    const { state, controller, selected } = fixture();
    controller.set({ ids: [2, 3], selectedId: null }, state);
    controller.set(null, state);
    finish();
    expect(selected).toEqual([]);
    controller.set({ ids: [2, 3], selectedId: null }, state);
    finish();
    controller.select(2);
    controller.reconcile({ ...state, turnSeat: 1 });
    finish();
    expect(selected).toEqual([]);
    controller.dispose();
    expect(controller.layer.children).toHaveLength(0);
  });

  it("切换预览仅当前原球显示轻波纹，减少动态偏好下无移动残留", () => {
    const { state, controller, selected } = fixture(true);
    controller.set({ ids: [2, 3], selectedId: null }, state);
    finish();
    controller.preview(2);
    controller.preview(3);
    expect(
      controller.layer.getObjectByName("selection-ripple-2")?.visible,
    ).toBe(false);
    expect(
      controller.layer.getObjectByName("selection-ripple-3")?.visible,
    ).toBe(true);
    controller.select(3);
    finish();
    expect(selected).toEqual([3]);
    expect(controller.active).toBe(false);
  });
});
