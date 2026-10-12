import { beforeAll, describe, expect, it } from "vitest";

import { AMERICAN_NINE, CHINESE_EIGHT, EQUIPMENT, SNOOKER } from "./equipment";
import { cushionSegments } from "./geometry";
import { ensurePhysicsReady, insidePlayArea, simulateShot } from "./physics";
import {
  getPocketGeometries,
  pocketAt,
  pocketLocal,
  pocketWorld,
} from "./pocket-geometry";
import { computeAimGuide } from "./render/guides";

beforeAll(async () => {
  await ensurePhysicsReady();
});

describe("器材配置隔离与袋口测量", () => {
  it("同时访问三种球桌不会覆盖已缓存的轮廓", () => {
    const chinese = getPocketGeometries(CHINESE_EIGHT);
    const snooker = getPocketGeometries(SNOOKER);
    const nine = getPocketGeometries(AMERICAN_NINE);
    expect(getPocketGeometries(CHINESE_EIGHT)).toBe(chinese);
    expect(chinese).not.toBe(snooker);
    expect(nine).not.toBe(chinese);
    expect(snooker[2].spec.originX).toBeCloseTo(1.7845);
    expect(chinese[2].spec.originX).toBe(1.27);
    expect(insidePlayArea(1.5, 0, CHINESE_EIGHT)).toBe(false);
    expect(insidePlayArea(1.5, 0, SNOOKER)).toBe(true);
  });

  it("九球按库鼻转折点测量mouth，按其连线中点测量搁板", () => {
    for (const pocket of getPocketGeometries(AMERICAN_NINE)) {
      const a = pocket.left[0];
      const b = pocket.right[0];
      const side = pocket.spec.kind === "side";
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(
        side ? 0.127 : 0.1143,
        8,
      );
      const entry = pocketLocal(pocket.spec, {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });
      expect(pocket.supportDepth - entry.y).toBeCloseTo(
        side ? 0.00635 : 0.0381,
        8,
      );
      const jawA = pocketLocal(pocket.spec, pocket.right[0]);
      const jawB = pocketLocal(pocket.spec, pocket.right[1]);
      const inward =
        (Math.atan2(jawA.x - jawB.x, jawB.y - jawA.y) * 180) / Math.PI;
      expect(inward + (side ? 90 : 135)).toBeCloseTo(side ? 104 : 142, 8);
    }
  });

  it("各模式库边保持凸形，Rapier凸包不填平入口", () => {
    for (const equipment of Object.values(EQUIPMENT)) {
      for (const { points } of cushionSegments(equipment)) {
        const turns = [];
        for (let i = 0; i < points.length; i += 2) {
          const j = (i + 2) % points.length;
          const k = (i + 4) % points.length;
          turns.push(
            (points[j] - points[i]) * (points[k + 1] - points[j + 1]) -
              (points[j + 1] - points[i + 1]) * (points[k] - points[j]),
          );
        }
        expect(
          turns.every((turn) => turn >= -1e-10) ||
            turns.every((turn) => turn <= 1e-10),
        ).toBe(true);
      }
    }
  });

  it("三种球桌均只在自己的开孔内越过支撑线后落袋", () => {
    for (const equipment of Object.values(EQUIPMENT)) {
      for (const pocket of getPocketGeometries(equipment)) {
        expect(
          pocketAt(
            pocketWorld(pocket.spec, 0, pocket.supportDepth - 1e-5),
            equipment,
          ),
        ).toBeUndefined();
        expect(
          pocketAt(
            pocketWorld(pocket.spec, 0, pocket.supportDepth + 1e-5),
            equipment,
          )?.id,
        ).toBe(pocket.spec.id);
      }
    }
  });
});

describe("多器材真实模拟与预览", () => {
  it.each(Object.values(EQUIPMENT))(
    "$id 的首碰位置使用该模式球径",
    (equipment) => {
      const balls = [
        { id: 0, x: 0, y: 0, potted: false },
        { id: 1, x: 0.3, y: 0, potted: false },
      ];
      const shot = { angle: 0, power: 0.2, followDraw: 0 };
      const sim = simulateShot(balls, shot, false, equipment);
      const guide = computeAimGuide(balls, 0, 0, 0.2, equipment);
      expect(sim.facts.firstContacts).toEqual([1]);
      expect(guide?.target?.id).toBe(1);
      expect(guide?.contact.x).toBeCloseTo(sim.firstImpact!.cue.x, 7);
      expect(guide?.contact.x).toBeCloseTo(0.3 - equipment.ballRadius * 2, 2);
    },
  );
});
