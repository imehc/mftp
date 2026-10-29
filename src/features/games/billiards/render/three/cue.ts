import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from "three";

import type { TableEquipment } from "../../equipment";
import type { BallState } from "../../types";
import { CUE_APPEARANCE, type CueBand, cueRadius } from "./cue-appearance";
import {
  createCueClearance,
  CUE_PULL_DISTANCE,
  CUE_TIP_GAP,
} from "./cue-clearance";
import { createCueHitTest } from "./cue-hit";
import type { Resources } from "./resources";

function cueTexture(band: CueBand, resources: Resources) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle =
    band.surface === "points"
      ? `#${band.color.toString(16).padStart(6, "0")}`
      : "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let fiber = 0; fiber < 48; fiber++) {
    context.strokeStyle = `rgba(76, 40, 12, ${0.035 + (fiber % 5) * 0.009})`;
    context.lineWidth = 0.5 + (fiber % 3) * 0.3;
    context.beginPath();
    for (let height = 0; height <= 512; height += 8) {
      const width = fiber * 5.5 + Math.sin(height * 0.018 + fiber) * 2;
      if (height === 0) context.moveTo(width, height);
      else context.lineTo(width, height);
    }
    context.stroke();
  }
  if (band.surface === "points") {
    context.fillStyle = "#f2dfbe";
    for (let point = 0; point < 4; point++) {
      const center = 32 + point * 64;
      context.beginPath();
      context.moveTo(center, 460);
      context.lineTo(center - 12, 180);
      context.lineTo(center, 24);
      context.lineTo(center + 12, 180);
      context.closePath();
      context.fill();
      context.strokeStyle = "#9d7541";
      context.stroke();
    }
  }
  const texture = resources.own(new CanvasTexture(canvas));
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createCue(equipment: TableEquipment, resources: Resources) {
  const layer = new Group();
  const stick = new Group();
  layer.add(stick);
  const length = equipment.cueLength;
  const appearance = CUE_APPEARANCE[equipment.id];
  const clearance = createCueClearance(equipment);

  let start = 0;
  for (const band of appearance.bands) {
    const end = band.end;
    const geometry = resources.own(
      new CylinderGeometry(
        cueRadius(equipment, end),
        cueRadius(equipment, start),
        (end - start) * length,
        48,
      ),
    );
    const texture = band.surface ? cueTexture(band, resources) : undefined;
    const material = resources.own(
      new MeshStandardMaterial({
        color: texture && band.surface === "points" ? 0xffffff : band.color,
        roughness: band.roughness,
        metalness: band.metalness ?? 0,
        map: texture,
      }),
    );
    const part = new Mesh(geometry, material);
    part.rotation.z = -Math.PI / 2;
    part.position.x = ((start + end) * length) / 2;
    part.castShadow = true;
    stick.add(part);
    start = end;
  }
  layer.visible = false;
  return {
    layer,
    hitTest: createCueHitTest(stick, length),
    pose(
      x: number,
      z: number,
      angle: number,
      pull: number,
      balls: readonly BallState[] = [],
      entrance = 0,
    ) {
      const elevation = clearance(x, z, angle, balls, entrance * length);
      const offset =
        equipment.ballRadius +
        CUE_TIP_GAP +
        pull * CUE_PULL_DISTANCE +
        entrance * length;
      layer.visible = true;
      layer.position.set(x, equipment.ballRadius, z);
      layer.rotation.y = Math.PI - angle;
      stick.position.set(
        Math.cos(elevation) * offset,
        Math.sin(elevation) * offset,
        0,
      );
      stick.rotation.z = elevation;
    },
  };
}
