import { describe, expect, it } from "vitest";

import { EQUIPMENT } from "./equipment";
import {
  getPocketGeometries,
  insidePolygon,
  pocketAt,
  pocketLocal,
  pocketShelfHeight,
  pocketWorld,
} from "./pocket-geometry";

describe("袋口前缘收圆与有效进球区域", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    it(`${equipment.id} 的圆孔承接袋颚且不会过度外移或越出桌框`, () => {
      const border = equipment.cushionWidth + equipment.frameWidth;
      for (const pocket of getPocketGeometries(equipment)) {
        const center = pocketWorld(pocket.spec, 0, pocket.cavityDepth);
        expect(
          equipment.tableHeight / 2 + border - Math.abs(center.y),
        ).toBeGreaterThan(pocket.cavityRadius + pocket.rimWidth);
        if (pocket.spec.kind === "corner")
          expect(
            equipment.tableWidth / 2 + border - Math.abs(center.x),
          ).toBeGreaterThan(pocket.cavityRadius + pocket.rimWidth);
        else {
          expect(center.x).toBe(0);
          if (equipment.side.shape === "round")
            expect(
              border -
                pocket.cavityDepth -
                pocket.cavityRadius -
                pocket.rimWidth,
            ).toBeGreaterThanOrEqual(0.005);
        }
        expect(pocket.cavityRadius).toBeGreaterThan(equipment.ballRadius);
        expect(pocket.front).toBeGreaterThan(pocket.entryFront);
        expect(pocket.cavityDepth).toBeGreaterThan(pocket.supportDepth);
        const side = getPocketGeometries(equipment).find(
          (p) => p.spec.kind === "side",
        )!;
        expect(Math.abs(center.y)).toBeCloseTo(
          equipment.tableHeight / 2 + side.cavityDepth,
          10,
        );
        if (pocket.spec.kind === "corner")
          expect(Math.abs(center.x)).toBeCloseTo(
            equipment.tableWidth / 2 + side.cavityDepth,
            10,
          );
        expect(pocketShelfHeight(pocket, pocket.entryFront)).toBeCloseTo(0, 10);
        expect(pocketShelfHeight(pocket, pocket.front)).toBe(-0.003);
      }
    });

    it(`${equipment.id} 的中袋包呢上沿朝袋后收拢且不挤占库鼻`, () => {
      if (equipment.id !== "chinese-eight") return;
      for (const pocket of getPocketGeometries(equipment).filter(
        (p) => p.spec.kind === "side",
      )) {
        const facing = pocket.facingRight.map((point) =>
          pocketLocal(pocket.spec, point),
        );
        for (let i = 1; i < facing.length; i++)
          expect(facing[i].x).toBeLessThanOrEqual(facing[i - 1].x + 1e-9);
        expect(facing[0].x).toBeGreaterThan(facing[facing.length - 1].x);
        const throat = facing[1];
        const angle =
          (Math.atan2(facing[0].x - throat.x, throat.y - facing[0].y) * 180) /
          Math.PI;
        expect(angle).toBeGreaterThanOrEqual(30);
        expect(angle).toBeLessThanOrEqual(45);
        expect(throat.x * 2).toBeCloseTo(equipment.side.width, 10);
        expect(throat.y).toBeCloseTo(pocket.supportDepth, 10);
        expect(facing.length).toBe(3);
        expect(facing[facing.length - 1].x).toBeCloseTo(
          pocket.facingRearHalf,
          10,
        );
        for (let i = 0; i < facing.length; i++) {
          if (facing[i].y > pocket.turnDepth) continue;
          expect(facing[i].x).toBeGreaterThanOrEqual(
            pocketLocal(pocket.spec, pocket.right[i]).x - 1e-9,
          );
        }
        // 进入袋腔后的扩口应朝袋后展开，不能再形成反向夹角。
        const shoulder = pocket.back
          .map((point) => pocketLocal(pocket.spec, point))
          .filter(
            (point) => point.x > 0 && point.y <= pocket.cavityDepth + 1e-9,
          );
        for (let i = 1; i < shoulder.length; i++)
          expect(shoulder[i].x).toBeGreaterThanOrEqual(
            shoulder[i - 1].x - 1e-9,
          );
      }
    });

    it(`${equipment.id} 的前缘对称收圆且不扩大台面切口`, () => {
      for (const pocket of getPocketGeometries(equipment)) {
        const { openingLocal, front } = pocket;
        expect(Math.min(...openingLocal.map((p) => p.y))).toBeCloseTo(
          front,
          10,
        );
        const forward = openingLocal.filter((p) => p.y < front + 0.0001);
        expect(forward.length).toBeGreaterThan(0);
        expect(forward.every((p) => Math.abs(p.x) < pocket.width / 4)).toBe(
          true,
        );
        for (const a of openingLocal) {
          expect(
            openingLocal.some((b) => Math.hypot(a.x + b.x, a.y - b.y) < 1e-9),
          ).toBe(true);
        }
      }
    });

    it(`${equipment.id} 可见圆孔内外与球心捕获范围保持一致`, () => {
      for (const pocket of getPocketGeometries(equipment)) {
        for (
          let offset = -pocket.cavityRadius - 0.0021;
          offset < pocket.cavityRadius + 0.002;
          offset += 0.004
        ) {
          for (
            let depth = pocket.front - 0.0021;
            depth < pocket.cavityDepth + pocket.cavityRadius + 0.002;
            depth += 0.004
          ) {
            const point = pocketWorld(pocket.spec, offset, depth);
            expect(
              pocketAt(point, equipment)?.id === pocket.spec.id,
              `${pocket.spec.id}: ${offset}, ${depth}`,
            ).toBe(insidePolygon(point, pocket.opening));
          }
        }
      }
    });
  }
});
