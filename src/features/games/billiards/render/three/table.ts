import {
  BufferGeometry,
  CircleGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from "three";

import type { TableEquipment } from "../../equipment";
import { cushionSegments } from "../../geometry";
import {
  getPocketGeometries,
  pocketWorld,
  type Point,
} from "../../pocket-geometry";
import { BAULK_X, COLOR_SPOTS, D_RADIUS } from "../../snooker-equipment";
import { tableLayout } from "../layout";
import { createCushionGeometry } from "./cushions";
import { createTableMaterials } from "./materials";
import { buildPockets } from "./pockets";
import type { Resources } from "./resources";

const vectors = (points: readonly Point[]) =>
  points.map((p) => new Vector2(p.x, -p.y));

function roundedRect(x: number, y: number, r: number) {
  const s = new Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r);
  s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y);
  s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r);
  s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** 台面开孔与木框内沿分别闭合，袋颚沿物理的完整曲线挤出。 */
export function createTableShapes(equipment: TableEquipment) {
  const { OUTER_W, OUTER_H, CORNER_RADIUS } = tableLayout(equipment);
  const pockets = getPocketGeometries(equipment);
  const cloth = roundedRect(OUTER_W, OUTER_H, CORNER_RADIUS);
  const slate = roundedRect(OUTER_W, OUTER_H, CORNER_RADIUS);
  for (const pocket of pockets) {
    cloth.holes.push(
      new Path(
        vectors(
          pocket.entryLocal.map((point) =>
            pocketWorld(pocket.spec, point.x, point.y),
          ),
        ),
      ),
    );
    slate.holes.push(
      new Path(
        vectors(
          pocket.openingLocal.map((point) =>
            pocketWorld(
              pocket.spec,
              point.x * 1.04,
              pocket.cavityDepth + (point.y - pocket.cavityDepth) * 1.04,
            ),
          ),
        ),
      ),
    );
  }
  const frame = roundedRect(OUTER_W, OUTER_H, CORNER_RADIUS);
  // 袋后半圆与相邻库背直接相接，形成一个含六个袋口的连续内沿。
  const inner = [...pockets]
    .sort(
      (a, b) =>
        Math.atan2(b.spec.originY, b.spec.originX) -
        Math.atan2(a.spec.originY, a.spec.originX),
    )
    .flatMap((p) =>
      p.back.map((point, i) => {
        // 木框退到袋沿下方，避免内壁与木框共面闪烁；两端仍落在真实库背。
        const clearance =
          i === 0 || i === p.back.length - 1 ? 0 : p.rimWidth * 0.45;
        return {
          x: point.x + p.backNormals[i].x * clearance,
          y: point.y + p.backNormals[i].y * clearance,
        };
      }),
    );
  frame.holes.push(new Path(vectors(inner)));
  const cushions = cushionSegments(equipment).map((segment) => {
    const points: Point[] = [];
    for (let i = 0; i < segment.points.length; i += 2)
      points.push({ x: segment.points[i], y: segment.points[i + 1] });
    return new Shape(vectors(points));
  });
  return { cloth, frame, slate, cushions };
}

export function buildTable(equipment: TableEquipment, resources: Resources) {
  const group = new Group();
  const materials = createTableMaterials(resources, equipment);
  const shapes = createTableShapes(equipment);
  const top = equipment.cushionHeight;

  const add = (
    geometry: BufferGeometry,
    material: typeof materials.cloth,
    y: number,
  ) => {
    const mesh = new Mesh(resources.own(geometry), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  add(
    new ExtrudeGeometry(shapes.slate, {
      depth: 0.05,
      bevelEnabled: false,
      curveSegments: 24,
    }),
    materials.slate,
    -0.056,
  ).name = "table-slate";
  add(new ShapeGeometry(shapes.cloth, 24), materials.cloth, 0).name =
    "table-cloth";
  const frame = add(
    new ExtrudeGeometry(shapes.frame, {
      depth: top + 0.065 - 0.0012,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.0012,
      bevelSize: 0.0012,
      bevelOffset: -0.0012,
      bevelSegments: 5,
      curveSegments: 24,
    }),
    materials.wood,
    -0.065,
  );
  // 短库木纹沿各自的长轴铺设；接缝藏在金属护角下。
  const framePositions = frame.geometry.getAttribute("position");
  const frameUV = frame.geometry.getAttribute("uv");
  for (let i = 0; i < framePositions.count; i++) {
    const x = framePositions.getX(i);
    const y = framePositions.getY(i);
    const endRail =
      Math.abs(x) > equipment.tableWidth / 2 + equipment.cushionWidth;
    frameUV.setXY(i, endRail ? y : x, endRail ? x : y);
  }
  frame.castShadow = true;
  for (const segment of cushionSegments(equipment)) {
    const cushion = new Mesh(
      resources.own(createCushionGeometry(segment, top)),
      materials.cloth,
    );
    cushion.castShadow = cushion.receiveShadow = true;
    group.add(cushion);
  }
  group.add(buildPockets(equipment, materials, resources));

  const marking = resources.own(
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: equipment.id === "snooker" ? 0.8 : 0.3,
      depthWrite: false,
    }),
  );
  const snooker = equipment.id === "snooker";
  const lineX = snooker ? BAULK_X : -equipment.tableWidth / 4;
  const line = new Shape();
  line.moveTo(lineX - 0.0008, -equipment.tableHeight / 2);
  line.lineTo(lineX + 0.0008, -equipment.tableHeight / 2);
  line.lineTo(lineX + 0.0008, equipment.tableHeight / 2);
  line.lineTo(lineX - 0.0008, equipment.tableHeight / 2);

  const mark = (geometry: BufferGeometry, x = 0, z = 0) => {
    const mesh = new Mesh(resources.own(geometry), marking);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.0005, z);
    group.add(mesh);
  };

  if (snooker) mark(new ShapeGeometry(line));
  if (snooker) {
    const arc = new Shape();
    arc.absarc(
      BAULK_X,
      0,
      D_RADIUS + 0.0008,
      Math.PI / 2,
      Math.PI * 1.5,
      false,
    );
    arc.absarc(BAULK_X, 0, D_RADIUS - 0.0008, Math.PI * 1.5, Math.PI / 2, true);
    mark(new ShapeGeometry(arc, 64));
  }
  for (const spot of snooker
    ? Object.values(COLOR_SPOTS)
    : [{ x: equipment.tableWidth / 4, y: 0 }])
    mark(new CircleGeometry(snooker ? 0.004 : 0.008, 24), spot.x, spot.y);
  const sightScale =
    equipment.id === "snooker" ? equipment.tableWidth / 2.54 : 1;
  const diamond = resources.own(
    new ShapeGeometry(
      new Shape([
        new Vector2(0, -0.013),
        new Vector2(0.01, 0),
        new Vector2(0, 0.013),
        new Vector2(-0.01, 0),
      ]),
    ),
  );

  const sight = (x: number, z: number) => {
    const mesh = new Mesh(diamond, materials.inlay);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(sightScale);
    mesh.position.set(x, top + 0.0005, z);
    group.add(mesh);
  };

  const sx =
    equipment.tableWidth / 2 +
    equipment.cushionWidth +
    equipment.frameWidth / 2;
  const sz =
    equipment.tableHeight / 2 +
    equipment.cushionWidth +
    equipment.frameWidth / 2;
  {
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      sight((k * equipment.tableWidth) / 8, sz);
      sight((k * equipment.tableWidth) / 8, -sz);
    }
    for (const k of [-1, 0, 1]) {
      sight(sx, (k * equipment.tableHeight) / 4);
      sight(-sx, (k * equipment.tableHeight) / 4);
    }
  }
  return group;
}
