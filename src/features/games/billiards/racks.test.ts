import { describe, expect, it } from "vitest";

import { BALL_RADIUS, FOOT_SPOT_X } from "./constants";
import { AMERICAN_NINE, SNOOKER } from "./equipment";
import { createNineBallRack } from "./racks";
import { createInitialBalls } from "./rules";
import { COLOR_SPOTS, createSnookerRack, isRed } from "./snooker-equipment";
import type { BallState, RedCount } from "./types";
import { ballGroup } from "./types";

/** 按 x 分组得到各排，再按 y 排序；用于不依赖 id 的位置断言。 */
function rows(balls: readonly BallState[], step: number): BallState[][] {
  const objects = balls.filter((b) => b.id !== 0);
  const minX = Math.min(...objects.map((b) => b.x));
  const grouped = new Map<number, BallState[]>();
  for (const ball of objects) {
    const row = Math.round((ball.x - minX) / step);
    grouped.set(row, [...(grouped.get(row) ?? []), ball]);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.sort((a, b) => a.y - b.y));
}

describe("黑八摆球", () => {
  const spacing = BALL_RADIUS * 2 + 0.0004;
  const rowStep = (spacing * Math.sqrt(3)) / 2;

  it("8 号固定在第三排中间，底角一全一花，其余随机且种子可复现", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const balls = createInitialBalls(seed);
      expect(balls).toEqual(createInitialBalls(seed));
      const layout = rows(balls, rowStep);
      expect(layout.map((r) => r.length)).toEqual([1, 2, 3, 4, 5]);
      expect(layout[2][1]).toMatchObject({
        id: 8,
        x: FOOT_SPOT_X + 2 * rowStep,
        y: 0,
      });
      const bottom = layout[4];
      const cornerGroups = [
        ballGroup(bottom[0].id),
        ballGroup(bottom[4].id),
      ].sort();
      expect(cornerGroups).toEqual(["solids", "stripes"]);
      seen.add(layout.map((r) => r.map((b) => b.id).join(",")).join("|"));
    }
    // 40 个种子里不应全是同一种排列。
    expect(seen.size).toBeGreaterThan(30);
  });

  it("底角的全色/花色各自随机，不固定为某一颗", () => {
    const solids = new Set<number>();
    const stripes = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const bottom = rows(createInitialBalls(seed), rowStep)[4];
      for (const corner of [bottom[0], bottom[4]]) {
        (ballGroup(corner.id) === "solids" ? solids : stripes).add(corner.id);
      }
    }
    expect(solids.size).toBeGreaterThan(3);
    expect(stripes.size).toBeGreaterThan(3);
  });

  it("15 颗目标球贴紧、无重叠、不含重复 id", () => {
    const balls = createInitialBalls(7).filter((b) => b.id !== 0);
    expect(new Set(balls.map((b) => b.id)).size).toBe(15);
    for (let i = 0; i < balls.length; i++)
      for (let j = i + 1; j < balls.length; j++) {
        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
        expect(d).toBeGreaterThanOrEqual(BALL_RADIUS * 2 - 1e-12);
      }
  });
});

describe("九球摆球", () => {
  it("1 号在顶点、9 号在菱形中心，其余随机", () => {
    const rack = createNineBallRack(5);
    const diameter = AMERICAN_NINE.ballRadius * 2;
    const layout = rows(rack, (diameter * Math.sqrt(3)) / 2);
    expect(layout.map((r) => r.length)).toEqual([1, 2, 3, 2, 1]);
    expect(layout[0][0].id).toBe(1);
    expect(layout[2][1].id).toBe(9);
    const others = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const l = rows(createNineBallRack(seed), (diameter * Math.sqrt(3)) / 2);
      expect(l[0][0].id).toBe(1);
      expect(l[2][1].id).toBe(9);
      others.add(
        l
          .flat()
          .map((b) => b.id)
          .join(","),
      );
    }
    expect(others.size).toBeGreaterThan(10);
  });
});

describe("斯诺克摆球", () => {
  const diameter = SNOOKER.ballRadius * 2;
  const rowStep = (diameter * Math.sqrt(3)) / 2;

  it.each([6, 10, 15] as RedCount[])(
    "%i 红球顶点紧靠粉球后方，底边平行顶库，球间贴紧且无号码顺序",
    (reds) => {
      const balls = createSnookerRack(reds, 3);
      const redBalls = balls.filter((b) => isRed(b.id));
      expect(redBalls).toHaveLength(reds);
      const layout = rows(redBalls, rowStep);
      const expectRows = reds === 6 ? 3 : reds === 10 ? 4 : 5;
      expect(layout.map((r) => r.length)).toEqual(
        Array.from({ length: expectRows }, (_, i) => i + 1),
      );
      // 顶点紧贴粉球后方，中心线上。
      const apex = layout[0][0];
      expect(apex.y).toBeCloseTo(0, 10);
      expect(apex.x - COLOR_SPOTS[6].x).toBeCloseTo(diameter + 0.0001, 10);
      // 底边各球 x 相同（平行顶库），相邻球间距为一个直径。
      const bottom = layout[layout.length - 1];
      for (const b of bottom) expect(b.x).toBeCloseTo(bottom[0].x, 10);
      for (let i = 1; i < bottom.length; i++)
        expect(bottom[i].y - bottom[i - 1].y).toBeCloseTo(diameter, 10);
      // id 分配随种子变化。
      const ids = (seed: number) =>
        rows(
          createSnookerRack(reds, seed).filter((b) => isRed(b.id)),
          rowStep,
        )
          .flat()
          .map((b) => b.id)
          .join(",");
      expect(ids(3)).toBe(ids(3));
      expect(ids(3)).not.toBe(ids(4));
    },
  );

  it("彩球点位：黄/绿在开球线与 D 交点，棕在线中点，蓝台心，粉蓝顶中点，黑距顶库 324mm", () => {
    const balls = createSnookerRack(15);
    const at = (id: number) => balls.find((b) => b.id === id)!;
    const baulk = -1.0475;
    const d = 0.292;
    const topCushion = 3.569 / 2;
    expect(at(2)).toMatchObject({ x: baulk, y: d });
    expect(at(3)).toMatchObject({ x: baulk, y: -d });
    expect(at(4)).toMatchObject({ x: baulk, y: 0 });
    expect(at(5)).toMatchObject({ x: 0, y: 0 });
    expect(at(6).y).toBe(0);
    expect(at(6).x).toBeCloseTo((0 + topCushion) / 2, 10);
    expect(at(7).y).toBe(0);
    expect(topCushion - at(7).x).toBeCloseTo(0.324, 10);
  });
});
