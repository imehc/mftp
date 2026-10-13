import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Shape,
  ShapeGeometry,
  ShapeUtils,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { TableEquipment } from "../../equipment";
import {
  getPocketGeometries,
  type PocketGeometry,
  pocketLocal,
  pocketShelfHeight,
  pocketWorld,
} from "../../pocket-geometry";
import type { createTableMaterials } from "./materials";
import {
  createCornerPocketPlate,
  createSidePocketPlate,
} from "./pocket-plates";
import type { Resources } from "./resources";

/** 包边只绕袋后半圆展开，剖面向木框内侧嵌入，不占用袋口净宽。 */
export function createPocketRim(pocket: PocketGeometry, top: number) {
  const profile = [
    [0, top - 0.005],
    [0.0004, top + 0.0003],
    [0.002, top + 0.0012],
    [0.004, top + 0.0012],
    [0.006, top - 0.001],
  ];
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = profile.length;
  const steps = pocket.back.length - 1;
  for (let i = 0; i <= steps; i++) {
    const point = pocket.back[i];
    const normal = pocket.backNormals[i];
    for (const [offset, height] of profile) {
      const width = (offset * pocket.rimWidth) / 0.006;
      const x = point.x + normal.x * width;
      const z = point.y + normal.y * width;
      vertices.push(x, height, z);
      uvs.push(x, z);
    }
    if (i === steps) continue;
    for (let j = 0; j < count; j++) {
      const a = i * count + j;
      const b = (i + 1) * count + j;
      const c = (i + 1) * count + ((j + 1) % count);
      const d = i * count + ((j + 1) % count);
      indices.push(a, c, b, a, d, c);
    }
  }
  const caps = ShapeUtils.triangulateShape(
    profile.map(([x, y]) => new Vector2(x, y)),
    [],
  );
  for (const [a, b, c] of caps) {
    indices.push(
      c,
      b,
      a,
      steps * count + a,
      steps * count + b,
      steps * count + c,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPocketWall(pocket: PocketGeometry, top: number) {
  const vertices: number[] = [];
  const indices: number[] = [];
  // 台呢前缘从零高度下落；袋颚之后抬升至包边内侧，防止斜视露出木框断面。
  for (let i = 0; i < pocket.opening.length; i++) {
    const point = pocket.opening[i];
    const local = pocket.openingLocal[i];
    const t = Math.max(
      0,
      Math.min(1, (local.y - pocket.front) / pocket.cavityRadius),
    );
    vertices.push(
      point.x,
      -0.003 + (top - 0.003) * t * t * (3 - 2 * t),
      point.y,
    );
    vertices.push(point.x, -0.14, point.y);
    const next = (i + 1) % pocket.opening.length;
    indices.push(i * 2, next * 2, next * 2 + 1, i * 2, next * 2 + 1, i * 2 + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPocketShelf(pocket: PocketGeometry) {
  const points = pocket.shelfLocal.map((point) =>
    pocketWorld(pocket.spec, point.x, point.y),
  );
  const geometry = new ShapeGeometry(
    new Shape(points.map((point) => new Vector2(point.x, -point.y))),
  );
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const depth = pocketLocal(pocket.spec, {
      x: positions.getX(vertex),
      y: -positions.getY(vertex),
    }).y;
    positions.setZ(vertex, pocketShelfHeight(pocket, depth));
    const span = pocket.front - pocket.entryFront;
    const fraction = Math.max(
      0,
      Math.min(1, (depth - pocket.entryFront) / span),
    );
    const slope = (-0.018 * fraction * (1 - fraction)) / span;
    const normal = new Vector3(
      -slope * pocket.spec.dx,
      -slope * pocket.spec.dy,
      1,
    ).normalize();
    normals.setXYZ(vertex, normal.x, normal.y, normal.z);
  }
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createPocketClothLip(pocket: PocketGeometry) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const steps = 64;
  const layers = 8;
  for (let step = 0; step <= steps; step++) {
    const angle = -(step / steps) * Math.PI;
    for (let layer = 0; layer <= layers; layer++) {
      const turn = ((layer / layers) * Math.PI) / 2;
      const radius = pocket.cavityRadius - 0.0015 * Math.sin(turn);
      const point = pocketWorld(
        pocket.spec,
        radius * Math.cos(angle),
        pocket.cavityDepth + radius * Math.sin(angle),
      );
      positions.push(point.x, -0.003 - 0.004 * (1 - Math.cos(turn)), point.y);
      uvs.push(point.x, -point.y);
      if (step === steps || layer === layers) continue;
      const first = step * (layers + 1) + layer;
      const next = first + layers + 1;
      indices.push(first, next + 1, next, first, first + 1, next + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPocketBackWall(pocket: PocketGeometry, top: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  pocket.back.forEach((point, vertex) => {
    const local = pocketLocal(pocket.spec, point);
    const normal = pocket.backNormals[vertex];
    const insetX = point.x - normal.x * 0.0002;
    const insetZ = point.y - normal.y * 0.0002;
    positions.push(
      insetX,
      top - 0.005,
      insetZ,
      insetX,
      pocketShelfHeight(pocket, local.y) - 0.002,
      insetZ,
    );
    if (vertex === pocket.back.length - 1) return;
    const first = vertex * 2;
    indices.push(first, first + 2, first + 3, first, first + 3, first + 1);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildPockets(
  equipment: TableEquipment,
  materials: ReturnType<typeof createTableMaterials>,
  resources: Resources,
) {
  const group = new Group();
  const top = equipment.cushionHeight;
  for (const pocket of getPocketGeometries(equipment)) {
    const shelf = new Mesh(
      resources.own(createPocketShelf(pocket)),
      materials.cloth,
    );
    shelf.name = `pocket-shelf-${pocket.spec.id}`;
    shelf.receiveShadow = true;
    const lip = new Mesh(
      resources.own(createPocketClothLip(pocket)),
      materials.cloth,
    );
    lip.name = `pocket-cloth-lip-${pocket.spec.id}`;
    lip.receiveShadow = true;
    const rim = new Mesh(
      resources.own(createPocketRim(pocket, top)),
      materials.rim,
    );
    rim.name = `pocket-rim-${pocket.spec.id}`;
    rim.castShadow = rim.receiveShadow = true;
    const plate = new Mesh(
      resources.own(
        pocket.spec.kind === "corner"
          ? createCornerPocketPlate(pocket, equipment, top)
          : createSidePocketPlate(pocket, equipment, top),
      ),
      materials.metal,
    );
    plate.name = `pocket-metal-plate-${pocket.spec.id}`;
    plate.castShadow = plate.receiveShadow = true;
    group.add(plate);
    const wall = new Mesh(
      resources.own(createPocketWall(pocket, top)),
      materials.pocket,
    );
    wall.receiveShadow = true;
    const backWall = new Mesh(
      resources.own(createPocketBackWall(pocket, top)),
      materials.pocket,
    );
    const center = pocketWorld(pocket.spec, 0, pocket.cavityDepth);
    const floor = new Mesh(
      resources.own(
        new CylinderGeometry(
          pocket.cavityRadius,
          pocket.cavityRadius * 0.8,
          0.08,
          64,
          1,
          false,
        ),
      ),
      materials.pocketFloor,
    );
    floor.position.set(center.x, -0.16, center.y);
    floor.receiveShadow = true;
    group.add(shelf, lip, rim, wall, backWall, floor);
    // 斯诺克与八球使用相同的暗色袋洞深度，不再展示编织网兜。
    if (equipment.id === "snooker") continue;
    const netGeometries: BufferGeometry[] = [];
    const cordCount = 16;
    for (let cord = 0; cord < cordCount; cord++) {
      const points = Array.from({ length: 13 }, (_, step) => {
        const fraction = step / 12;
        const angle = (cord / 16) * Math.PI * 2 + fraction * Math.PI * 0.2;
        const radius = pocket.cavityRadius * (1 - fraction * 0.2);
        const point = pocketWorld(
          pocket.spec,
          radius * Math.cos(angle),
          pocket.cavityDepth + radius * Math.sin(angle),
        );
        return new Vector3(point.x, -0.07 - fraction * 0.11, point.y);
      });
      netGeometries.push(
        new TubeGeometry(new CatmullRomCurve3(points), 24, 0.0007, 4, false),
      );
    }
    for (let band = 0; band < 6; band++) {
      const fraction = band / 5;
      const points = Array.from({ length: 33 }, (_, step) => {
        const angle = (step / 32) * Math.PI * 2;
        const radius = pocket.cavityRadius * (1 - fraction * 0.2);
        const point = pocketWorld(
          pocket.spec,
          radius * Math.cos(angle),
          pocket.cavityDepth + radius * Math.sin(angle),
        );
        return new Vector3(point.x, -0.07 - fraction * 0.11, point.y);
      });
      netGeometries.push(
        new TubeGeometry(new CatmullRomCurve3(points), 64, 0.0007, 4, true),
      );
    }
    const netGeometry = mergeGeometries(netGeometries);
    netGeometries.forEach((geometry) => geometry.dispose());
    if (netGeometry)
      group.add(new Mesh(resources.own(netGeometry), materials.net));
  }
  return group;
}
