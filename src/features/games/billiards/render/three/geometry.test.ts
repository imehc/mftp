import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  ShapeGeometry,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import { EQUIPMENT } from "../../equipment";
import { cushionSegments } from "../../geometry";
import {
  getPocketGeometries,
  pocketLocal,
  pocketWorld,
} from "../../pocket-geometry";
import { tableLayout } from "../layout";
import { createTableCamera } from "./camera";
import { createCushionGeometry } from "./cushions";
import {
  createCornerPocketPlate,
  createSidePocketPlate,
} from "./pocket-plates";
import {
  createPocketClothLip,
  createPocketRim,
  createPocketShelf,
} from "./pockets";
import { createTableShapes } from "./table";

describe("三维球桌与物理轮廓对齐", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 的六个袋口贯穿台面和木框`, () => {
      const shapes = createTableShapes(equipment);
      for (const shape of [shapes.cloth, shapes.frame, shapes.slate]) {
        const geometry = new ShapeGeometry(shape);
        expect(
          Array.from(geometry.getAttribute("position").array).every(
            Number.isFinite,
          ),
        ).toBe(true);
        const mesh = new Mesh(geometry, new MeshBasicMaterial());
        mesh.rotation.x = -Math.PI / 2;
        mesh.updateMatrixWorld();
        for (const pocket of getPocketGeometries(equipment)) {
          for (const offset of [-0.65, 0, 0.65]) {
            const point = pocketWorld(
              pocket.spec,
              offset * pocket.cavityRadius,
              pocket.cavityDepth,
            );
            const ray = new Raycaster(
              new Vector3(point.x, 1, point.y),
              new Vector3(0, -1, 0),
            );
            expect(ray.intersectObject(mesh)).toHaveLength(0);
          }
        }
        geometry.dispose();
        mesh.material.dispose();
      }
    });

    it(`${equipment.id} 的入口台呢连续承接石板且袋沿不横跨开孔`, () => {
      const material = new MeshBasicMaterial({ side: DoubleSide });
      for (const pocket of getPocketGeometries(equipment)) {
        const shelf = createPocketShelf(pocket);
        const rim = createPocketRim(pocket, equipment.cushionHeight);
        const lip = createPocketClothLip(pocket);
        const shelfMesh = new Mesh(shelf, material);
        const rimMesh = new Mesh(rim, material);
        const lipMesh = new Mesh(lip, material);
        for (const mesh of [shelfMesh, rimMesh, lipMesh])
          mesh.updateMatrixWorld();
        const before = pocketWorld(
          pocket.spec,
          0,
          (pocket.entryFront + pocket.front) / 2,
        );
        const shelfRay = new Raycaster(
          new Vector3(before.x, 1, before.y),
          new Vector3(0, -1, 0),
        );
        expect(shelfRay.intersectObject(shelfMesh).length).toBeGreaterThan(0);
        for (const offset of [-0.6, 0, 0.6]) {
          const center = pocketWorld(
            pocket.spec,
            offset * pocket.cavityRadius,
            pocket.cavityDepth,
          );
          const holeRay = new Raycaster(
            new Vector3(center.x, 1, center.y),
            new Vector3(0, -1, 0),
          );
          for (const mesh of [shelfMesh, rimMesh, lipMesh])
            expect(holeRay.intersectObject(mesh)).toHaveLength(0);
        }
        for (const geometry of [shelf, rim, lip]) {
          expect(
            Array.from(geometry.getAttribute("normal").array).every(
              Number.isFinite,
            ),
          ).toBe(true);
          geometry.dispose();
        }
      }
      material.dispose();
    });

    it(`${equipment.id} 的包呢上沿没有倒角自交`, () => {
      for (const segment of cushionSegments(equipment)) {
        const geometry = createCushionGeometry(
          segment,
          equipment.cushionHeight,
        );
        const position = geometry.getAttribute("position");
        const count = segment.points.length / 2;
        const start = position.count - count;
        const points = Array.from({ length: count }, (_, i) => ({
          x: position.getX(start + i),
          y: position.getZ(start + i),
        }));
        const cross = (
          a: { x: number; y: number },
          b: { x: number; y: number },
          c: { x: number; y: number },
        ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        for (let i = 0; i < count; i++) {
          const a = points[i];
          const b = points[(i + 1) % count];
          for (let j = i + 2; j < count; j++) {
            if (i === 0 && j === count - 1) continue;
            const c = points[j];
            const d = points[(j + 1) % count];
            const intersect =
              cross(a, b, c) * cross(a, b, d) < -1e-16 &&
              cross(c, d, a) * cross(c, d, b) < -1e-16;
            expect(intersect, `${i} / ${j}`).toBe(false);
          }
        }
        geometry.dispose();
      }
    });

    it(`${equipment.id} 的四角金属护角贴合外框且保持袋孔贯通`, () => {
      const material = new MeshBasicMaterial({ side: DoubleSide });
      for (const pocket of getPocketGeometries(equipment).filter(
        (p) => p.spec.kind === "corner",
      )) {
        const geometry = createCornerPocketPlate(
          pocket,
          equipment,
          equipment.cushionHeight,
        );
        const mesh = new Mesh(geometry, material);
        mesh.updateMatrixWorld();
        const center = pocketWorld(pocket.spec, 0, pocket.cavityDepth);
        expect(
          new Raycaster(
            new Vector3(center.x, 1, center.y),
            new Vector3(0, -1, 0),
          ).intersectObject(mesh),
        ).toHaveLength(0);
        const sx = Math.sign(pocket.spec.dx);
        const sy = Math.sign(pocket.spec.dy);
        const border = equipment.cushionWidth + equipment.frameWidth;
        const outerInset = tableLayout(equipment).CORNER_RADIUS * 0.35;
        const outer = new Vector3(
          pocket.spec.originX + sx * (border - outerInset),
          1,
          pocket.spec.originY + sy * (border - outerInset),
        );
        expect(
          new Raycaster(outer, new Vector3(0, -1, 0)).intersectObject(mesh)
            .length,
        ).toBeGreaterThan(0);
        const uv = geometry.getAttribute("uv");
        expect(Array.from(uv.array).every(Number.isFinite)).toBe(true);
        geometry.dispose();
      }
      material.dispose();
    });

    it(`${equipment.id} 的中袋金属片留在木框上且不遮挡圆孔`, () => {
      const material = new MeshBasicMaterial({ side: DoubleSide });
      for (const pocket of getPocketGeometries(equipment).filter(
        (p) => p.spec.kind === "side",
      )) {
        const geometry = createSidePocketPlate(
          pocket,
          equipment,
          equipment.cushionHeight,
        );
        expect(
          Array.from(geometry.getAttribute("position").array).every(
            Number.isFinite,
          ),
        ).toBe(true);
        const positions = geometry.getAttribute("position");
        const front = Math.min(
          ...Array.from(
            { length: positions.count },
            (_, i) =>
              pocketLocal(pocket.spec, {
                x: positions.getX(i),
                y: positions.getZ(i),
              }).y,
          ),
        );
        expect(front).toBeGreaterThanOrEqual(equipment.cushionWidth - 0.002);
        const mesh = new Mesh(geometry, material);
        mesh.updateMatrixWorld();
        for (const u of [-0.6, 0, 0.6]) {
          const center = pocketWorld(
            pocket.spec,
            pocket.cavityRadius * u,
            pocket.cavityDepth,
          );
          expect(
            new Raycaster(
              new Vector3(center.x, 1, center.y),
              new Vector3(0, -1, 0),
            ).intersectObject(mesh),
          ).toHaveLength(0);
        }
        const rear = pocketWorld(
          pocket.spec,
          0,
          equipment.cushionWidth + equipment.frameWidth - 0.003,
        );
        expect(
          new Raycaster(
            new Vector3(rear.x, 1, rear.y),
            new Vector3(0, -1, 0),
          ).intersectObject(mesh).length,
        ).toBeGreaterThan(0);
        geometry.dispose();
      }
      material.dispose();
    });

    it(`${equipment.id} 在窄屏与横屏完整入画且只由视口决定朝向`, () => {
      const { OUTER_W, OUTER_H } = tableLayout(equipment);
      const camera = createTableCamera(equipment);
      for (const [width, height, portrait] of [
        [320, 600, true],
        [390, 600, true],
        [767, 600, true],
        [768, 400, false],
        [1024, 600, false],
        [1440, 600, false],
        [844, 240, false],
      ] as const) {
        camera.resize(width, height, portrait);
        for (const x of [-OUTER_W, OUTER_W]) {
          for (const z of [-OUTER_H, OUTER_H]) {
            const p = new Vector3(x, 0.05, z).project(camera.camera);
            expect(Math.abs(p.x)).toBeLessThan(1);
            expect(Math.abs(p.y)).toBeLessThan(1);
          }
        }
        expect(camera.camera.up.x).toBe(portrait ? 1 : 0);
      }
    });
  }
});
