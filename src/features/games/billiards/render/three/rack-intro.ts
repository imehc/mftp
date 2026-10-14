import { Group, Mesh, MeshPhysicalMaterial, Quaternion, Vector3 } from "three";

import type { TableEquipment } from "../../equipment";
import type { BilliardsState } from "../../types";
import type { createBallLayer } from "./balls";
import type { createTableCamera } from "./camera";
import { rackBallPositions, rackGeometry, rackLayout } from "./rack-geometry";
import type { Resources } from "./resources";

export interface RackPose {
  push: number;
  lift: number;
  exit: number;
  opacity: number;
}

export function createRackIntro(
  equipment: TableEquipment,
  balls: ReturnType<typeof createBallLayer>,
  camera: ReturnType<typeof createTableCamera>,
  resources: Resources,
) {
  const layer = new Group();
  const axis = new Vector3(0, 0, 1);
  const rotation = new Quaternion();
  const orientations = new Map<number, Quaternion>();
  let layout: ReturnType<typeof rackLayout> = null;
  let frame: Mesh | null = null;
  let active = false;
  let pose: RackPose = { push: 0, lift: 0, exit: 0, opacity: 1 };
  return {
    layer,
    get active() {
      return active;
    },
    prepare(state: BilliardsState) {
      layout = rackLayout(equipment, state);
      if (!layout) return false;
      const material = resources.own(
        new MeshPhysicalMaterial({
          color: 0x825635,
          roughness: 0.34,
          metalness: 0,
          clearcoat: 0.55,
          clearcoatRoughness: 0.3,
          transparent: true,
        }),
      );
      frame = new Mesh(resources.own(rackGeometry(layout)), material);
      frame.castShadow = true;
      frame.receiveShadow = true;
      layer.add(frame);
      for (const ball of layout.balls) {
        const mesh = balls.meshes.get(ball.id);
        if (mesh) orientations.set(ball.id, mesh.quaternion.clone());
      }
      camera.focus(layout.focus);
      camera.entrance(1);
      active = true;
      return true;
    },
    update(next: RackPose = pose) {
      pose = next;
      if (!active || !layout || !frame) return;
      const offset = -layout.pushDistance * (1 - pose.push);
      for (const ball of rackBallPositions(layout, pose.push)) {
        const mesh = balls.meshes.get(ball.id);
        const orientation = orientations.get(ball.id);
        if (!mesh || !orientation) continue;
        mesh.position.set(ball.x, equipment.ballRadius, ball.y);
        // 从终态反算剩余滚动角，任意进度更新和 resize 都不会累计漂移。
        rotation.setFromAxisAngle(axis, -offset / equipment.ballRadius);
        mesh.quaternion.copy(orientation).premultiply(rotation);
      }
      frame.position.set(
        offset + pose.exit * equipment.ballRadius * 2,
        pose.lift * equipment.ballRadius * 4.5,
        0,
      );
      (frame.material as MeshPhysicalMaterial).opacity = pose.opacity;
      frame.visible = pose.opacity > 0;
      layer.visible = frame.visible;
    },
    finish() {
      if (!active || !layout) return;
      pose = { push: 1, lift: 1, exit: 1, opacity: 0 };
      for (const ball of layout.balls) {
        const mesh = balls.meshes.get(ball.id);
        const orientation = orientations.get(ball.id);
        if (!mesh || !orientation) continue;
        mesh.position.set(ball.x, equipment.ballRadius, ball.y);
        mesh.quaternion.copy(orientation);
      }
      layer.clear();
      if (frame) {
        resources.release(frame.geometry);
        resources.release(frame.material as MeshPhysicalMaterial);
      }
      orientations.clear();
      frame = null;
      active = false;
      camera.entrance(0);
      camera.focus(null);
    },
  };
}
