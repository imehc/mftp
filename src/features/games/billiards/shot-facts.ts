/** 裁判使用未经过音效阈值/回放降采样的事实；不在物理层决定比赛结果。 */
import { type TableEquipment } from "./equipment";
import { cushionSegments } from "./geometry";
import type { BallState } from "./types";

export interface RailContact {
  ball: number;
  rail: number;
  t: number;
}

export interface ShotFacts {
  firstContacts: number[];
  firstContactTime: number | null;
  rails: RailContact[];
  crossedHeadString: number[];
  frozenRails: { ball: number; rail: number }[];
  touchingCue: number[];
}

export function distanceToEdge(
  x: number,
  y: number,
  points: readonly number[],
): number {
  let nearest = Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const j = (i + 2) % points.length;
    const dx = points[j] - points[i];
    const dy = points[j + 1] - points[i + 1];
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((x - points[i]) * dx + (y - points[i + 1]) * dy) / length2,
            ),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(x - points[i] - t * dx, y - points[i + 1] - t * dy),
    );
  }
  return nearest;
}

export function createShotFacts(
  balls: readonly BallState[],
  equipment: TableEquipment,
) {
  const radius = equipment.ballRadius;
  const active = balls.filter((ball) => !ball.potted);
  const cue = active.find((ball) => ball.id === 0);
  const cushions = cushionSegments(equipment);
  const facts: ShotFacts = {
    firstContacts: [],
    firstContactTime: null,
    rails: [],
    crossedHeadString: [],
    frozenRails: active.flatMap((ball) =>
      cushions.flatMap((rail, index) =>
        distanceToEdge(ball.x, ball.y, rail.points) <= radius + 0.00002
          ? [{ ball: ball.id, rail: index }]
          : [],
      ),
    ),
    touchingCue: cue
      ? active
          .filter(
            (ball) =>
              ball.id !== 0 &&
              Math.hypot(ball.x - cue.x, ball.y - cue.y) <=
                radius * 2 + 0.00002,
          )
          .map((ball) => ball.id)
      : [],
  };
  const frozen = new Set(
    facts.frozenRails.map(({ ball, rail }) => `${ball}:${rail}`),
  );
  const touchingRails = new Set<string>();
  const crossed = new Set<number>();
  return {
    facts,
    ballContact(a: number, b: number, t: number) {
      if (a !== 0 && b !== 0) return;
      const target = a === 0 ? b : a;
      facts.firstContactTime ??= t;
      // 同一物理步内仍使用碰前扫掠时间；只合并数值容差内的同时首碰。
      if (
        Math.abs(t - facts.firstContactTime) <= 1e-6 &&
        !facts.firstContacts.includes(target)
      ) {
        facts.firstContacts.push(target);
      }
    },
    railContact(ball: number, rail: number, t: number) {
      const key = `${ball}:${rail}`;
      if (!frozen.has(key) && !touchingRails.has(key))
        facts.rails.push({ ball, rail, t });
      touchingRails.add(key);
    },
    releaseRail(ball: number, rail: number) {
      const key = `${ball}:${rail}`;
      frozen.delete(key);
      touchingRails.delete(key);
    },
    position(ball: number, previousX: number, x: number) {
      const head = -equipment.tableWidth / 4;
      if (ball !== 0 && previousX >= head && x < head && !crossed.has(ball)) {
        crossed.add(ball);
        facts.crossedHeadString.push(ball);
      }
    },
  };
}
