import { CircleGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import type { TableEquipment } from "../../equipment";
import type { AimGuide } from "../guides";
import type { Resources } from "./resources";

export function createHud(equipment: TableEquipment, resources: Resources) {
  const layer = new Group();
  const materials: LineMaterial[] = [];

  const makeLine = (
    positions: number[],
    color: number,
    opacity: number,
    width: number,
    dashed = false,
  ) => {
    const geometry = resources.own(new LineGeometry());
    geometry.setPositions(positions);
    const material = resources.own(
      new LineMaterial({
        color,
        opacity,
        linewidth: width,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        dashed,
        dashSize: 0.018,
        gapSize: 0.012,
      }),
    );
    material.userData.opacity = opacity;
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 5;
    line.frustumCulled = false;
    materials.push(material);
    layer.add(line);
    return line;
  };

  const points = [0, 0.0005, 0, 1, 0.0005, 0];
  const aim = makeLine(points, 0xffffff, 0.62, 1.3, true);
  const target = makeLine(points, 0xffe1a0, 0.9, 1.6);
  const deflection = makeLine(points, 0xffffff, 0.36, 1.1);
  const circle: number[] = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    circle.push(
      Math.cos(angle) * equipment.ballRadius,
      0.0005,
      Math.sin(angle) * equipment.ballRadius,
    );
  }
  const ghost = makeLine(circle, 0xffffff, 0.7, 1);
  const placement = makeLine(circle, 0x9fe8bd, 0.85, 1.5);
  placement.name = "cue-placement-ring";
  placement.scale.set(1.5, 1, 1.5);
  const fillMaterial = resources.own(
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.04,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const fill = new Mesh(
    resources.own(new CircleGeometry(equipment.ballRadius, 48)),
    fillMaterial,
  );
  fill.rotation.x = -Math.PI / 2;
  fill.renderOrder = 4;
  layer.add(fill);

  const segment = (
    line: Line2,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => {
    const { instanceStart, instanceEnd, instanceDistanceEnd } =
      line.geometry.attributes;
    instanceStart.setXYZ(0, ax, 0.0005, az);
    instanceEnd.setXYZ(0, bx, 0.0005, bz);
    instanceStart.needsUpdate = true;
    instanceEnd.needsUpdate = true;
    instanceDistanceEnd.setX(0, Math.hypot(bx - ax, bz - az));
    instanceDistanceEnd.needsUpdate = true;
    line.visible = true;
  };

  return {
    layer,
    clear() {
      for (const child of layer.children) child.visible = false;
    },
    resize(width: number, height: number) {
      for (const material of materials) material.resolution.set(width, height);
    },
    opacity(value: number) {
      for (const material of materials)
        material.opacity = material.userData.opacity * value;
      fillMaterial.opacity = 0.04 * value;
    },
    placement(x: number, z: number, valid: boolean) {
      // 摆放圈表示球心而非台面落点；透视机位下必须与球心等高，避免近库时错位。
      placement.position.set(x, equipment.ballRadius - 0.0005, z);
      placement.visible = true;
      placement.material.color.setHex(valid ? 0x9fe8bd : 0xd93025);
    },
    guide(guide: AimGuide) {
      const { cue, contact, dir } = guide;
      segment(
        aim,
        cue.x + dir.x * equipment.ballRadius,
        cue.y + dir.y * equipment.ballRadius,
        contact.x,
        contact.y,
      );
      ghost.position.set(contact.x, 0, contact.y);
      ghost.visible = true;
      fill.position.set(contact.x, 0.0005, contact.y);
      fill.visible = true;
      if (guide.target) {
        const { center, dir, length } = guide.target;
        segment(
          target,
          center.x,
          center.y,
          center.x + dir.x * length,
          center.y + dir.y * length,
        );
        if (guide.cueDeflection)
          segment(
            deflection,
            contact.x,
            contact.y,
            contact.x + guide.cueDeflection.x * guide.cueLength,
            contact.y + guide.cueDeflection.y * guide.cueLength,
          );
      }
    },
  };
}
