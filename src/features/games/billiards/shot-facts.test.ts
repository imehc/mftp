import { beforeAll, describe, expect, it } from "vitest";

import { AMERICAN_NINE } from "./equipment";
import { ensurePhysicsReady, simulateShot } from "./physics";
import { createShotFacts } from "./shot-facts";

beforeAll(async () => {
  await ensurePhysicsReady();
});

describe("独立于音效与回放的裁判事实", () => {
  it("低于音效阈值的真实轻碰仍保留首碰事实", () => {
    const results = [0.0528, 0.053, 0.0532, 0.0534, 0.0536].map((gap) =>
      simulateShot(
        [
          { id: 0, x: 0, y: 0, potted: false },
          { id: 1, x: AMERICAN_NINE.ballRadius * 2 + gap, y: 0, potted: false },
        ],
        { angle: 0, power: 0.02, followDraw: 0 },
        false,
        AMERICAN_NINE,
      ),
    );
    expect(
      results.some(
        (sim) =>
          sim.facts.firstContacts.includes(1) &&
          !sim.events.some((event) => event.type === "ball-ball"),
      ),
    ).toBe(true);
  });

  it("同时首碰保留所有目标，后续碰撞不混入首碰集合", () => {
    const record = createShotFacts([], AMERICAN_NINE);
    record.ballContact(1, 0, 0.1);
    record.ballContact(0, 2, 0.1000001);
    record.ballContact(0, 3, 0.11);
    expect(record.facts.firstContacts).toEqual([1, 2]);
  });

  it("目标球必须越过头线，反复往返只计一次，母球不计", () => {
    const record = createShotFacts([], AMERICAN_NINE);
    record.position(1, 0, -0.635);
    expect(record.facts.crossedHeadString).toEqual([]);
    record.position(1, -0.635, -0.636);
    record.position(1, -0.63, -0.64);
    record.position(0, -0.63, -0.64);
    record.position(2, -0.63, -0.64);
    expect(record.facts.crossedHeadString).toEqual([1, 2]);
  });

  it("开局贴库不算新碰库，离开后重新接触才计入", () => {
    const ball = {
      id: 1,
      x: 0.3,
      y: AMERICAN_NINE.tableHeight / 2 - AMERICAN_NINE.ballRadius,
      potted: false,
    };
    const record = createShotFacts([ball], AMERICAN_NINE);
    const rail = record.facts.frozenRails[0].rail;
    record.railContact(1, rail, 0.1);
    expect(record.facts.rails).toEqual([]);
    record.releaseRail(1, rail);
    record.railContact(1, rail, 0.2);
    record.railContact(1, rail, 0.21);
    expect(record.facts.rails).toEqual([{ ball: 1, rail, t: 0.2 }]);
  });

  it("真实击球保留首碰之后的有效库边接触", () => {
    const sim = simulateShot(
      [
        { id: 0, x: 0.1, y: 0, potted: false },
        { id: 1, x: 0.1, y: 0.2, potted: false },
      ],
      { angle: Math.PI / 2, power: 0.25, followDraw: 0 },
      false,
      AMERICAN_NINE,
    );
    expect(sim.facts.firstContacts).toEqual([1]);
    expect(
      sim.facts.rails.some(
        (contact) =>
          contact.ball === 1 && contact.t > sim.facts.firstContactTime!,
      ),
    ).toBe(true);
  });
});
