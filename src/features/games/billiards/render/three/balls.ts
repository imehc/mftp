import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

import { ballDefinition } from "../../ball-definitions";
import type { TableEquipment } from "../../equipment";
import {
  getPocketGeometries,
  type PocketGeometry,
} from "../../pocket-geometry";
import type { BallState } from "../../types";
import type { PlaybackBallView } from "../playback";
import { buildBallPolishTexture } from "./ball-surface";
import { buildBallTexture } from "./ball-texture";
import { pocketDropPosition } from "./pocket-drop";
import type { Resources } from "./resources";

export function createBallLayer(
  equipment: TableEquipment,
  ids: readonly number[],
  mobile: boolean,
  resources: Resources,
) {
  const layer = new Group();
  const geometry = resources.own(
    new SphereGeometry(
      equipment.ballRadius,
      mobile ? 32 : 48,
      mobile ? 24 : 32,
    ),
  );
  const materials = new Map<string, MeshPhysicalMaterial>();
  const views = new Map<number, Mesh<SphereGeometry, MeshPhysicalMaterial>>();
  const playbackViews = new Map<number, PlaybackBallView>();
  const sinks = new Map<number, PocketGeometry>();
  const dropMaterials = new Map<number, MeshPhysicalMaterial>();
  const baseMaterials = new Map<number, MeshPhysicalMaterial>();
  const polish = resources.own(buildBallPolishTexture());
  for (const id of ids) {
    const definition = ballDefinition(id, equipment.id);
    const key = JSON.stringify(definition);
    let material = materials.get(key);
    if (!material) {
      material = resources.own(
        new MeshPhysicalMaterial({
          map: resources.own(buildBallTexture(definition)),
          roughness: 0.27,
          roughnessMap: polish,
          clearcoat: 1,
          clearcoatRoughness: 0.3,
          clearcoatRoughnessMap: polish,
          envMapIntensity: 1.2,
          metalness: 0,
        }),
      );
      materials.set(key, material);
    }
    const view = new Mesh(geometry, material);
    view.castShadow = true;
    view.receiveShadow = true;
    view.visible = false;
    // 贴图中心位于球体 +X，初始朝上略偏向开球端，数字随真实朝向滚动。
    view.rotation.z = Math.PI * 0.6;
    view.rotateX(-Math.PI / 2);
    if (definition.number !== null)
      view.quaternion.premultiply(
        new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0),
          Math.sin(id * 2.4) * 0.3,
        ),
      );
    else {
      // 共用的红球纹理采用稳定的不同朝向，避免开球时出现整齐一致的明暗图案。
      view.rotateX(id * 2.399963);
      view.rotateY(id * 1.618034);
    }
    baseMaterials.set(id, material);
    const dropMaterial = resources.own(material.clone());
    dropMaterial.transparent = true;
    dropMaterials.set(id, dropMaterial);
    playbackViews.set(id, {
      get visible() {
        return view.visible;
      },
      set visible(value) {
        view.visible = value;
      },
      get alpha() {
        return view.material.opacity;
      },
      set alpha(value) {
        view.material.opacity = value;
      },
      sink(progress, event) {
        const pocket = sinks.get(id);
        if (!pocket) return;
        const position = pocketDropPosition(equipment, pocket, event, progress);
        const distanceX = position.x - view.position.x;
        const distanceZ = position.z - view.position.z;
        const distance = Math.hypot(distanceX, distanceZ);
        if (distance > 1e-7 && progress < 0.58) {
          axis.set(distanceZ / distance, 0, -distanceX / distance);
          rotation.setFromAxisAngle(axis, distance / equipment.ballRadius);
          view.quaternion.premultiply(rotation).normalize();
        }
        view.position.set(position.x, position.y, position.z);
        view.material.opacity = position.alpha;
      },
    });
    views.set(id, view);
    layer.add(view);
  }
  const axis = new Vector3();
  const rotation = new Quaternion();
  return {
    layer,
    meshes: views,
    view: (id: number) => playbackViews.get(id),
    maskPocket(id: number, pocketId: number) {
      const view = views.get(id);
      const pocket = getPocketGeometries(equipment).find(
        (p) => p.spec.id === pocketId,
      );
      if (!view || !pocket || sinks.has(id)) return;
      sinks.set(id, pocket);
      view.material = dropMaterials.get(id)!;
      view.material.opacity = 1;
    },
    place(x: number, z: number, valid: boolean) {
      const view = views.get(0);
      if (!view) return;
      view.visible = true;
      view.position.set(x, equipment.ballRadius, z);
      view.material.emissive.setHex(valid ? 0 : 0x991611);
      view.material.emissiveIntensity = 0.5;
    },
    move(id: number, x: number, z: number, rolling: boolean) {
      const view = views.get(id);
      if (!view) return;
      const dx = x - view.position.x;
      const dz = z - view.position.z;
      const distance = Math.hypot(dx, dz);
      if (rolling && distance > 1e-7) {
        axis.set(dz / distance, 0, -dx / distance);
        rotation.setFromAxisAngle(axis, distance / equipment.ballRadius);
        view.quaternion.premultiply(rotation).normalize();
      }
      view.position.x = x;
      view.position.z = z;
    },
    sync(balls: BallState[]) {
      sinks.clear();
      for (const ball of balls) {
        const view = views.get(ball.id);
        if (!view) continue;
        view.material = baseMaterials.get(ball.id)!;
        view.material.opacity = 1;
        view.material.emissive.setHex(0);
        view.position.set(ball.x, equipment.ballRadius, ball.y);
        view.visible = !ball.potted;
      }
    },
  };
}
