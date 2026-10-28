import { describe, expect, it } from "vitest";

import {
  applyMove,
  createCube,
  faceMove,
  inverseMove,
  isSolved,
  scrambleMoves,
} from "./engine";
import { type Axis, type CubeMove, ORDERS } from "./types";

describe("多阶魔方整数规则", () => {
  for (const order of ORDERS) {
    it(`${order} 阶每一层四次转动及正反转均复原`, () => {
      const initial = createCube(order);
      expect(isSolved(initial)).toBe(true);
      for (const axis of [0, 1, 2] as Axis[]) {
        for (let layer = 0; layer < order; layer++) {
          const move: CubeMove = { axis, layer, turns: 1 };
          const once = applyMove(initial, move);
          expect(isSolved(once)).toBe(false);
          expect(applyMove(once, inverseMove(move))).toEqual(initial);
          expect([move, move, move, move].reduce(applyMove, initial)).toEqual(
            initial,
          );
          expect(applyMove(initial, { ...move, turns: 2 })).toEqual(
            applyMove(once, move),
          );
        }
      }
    });

    it(`${order} 阶长序列逆转无漂移，整块转向仍为复原`, () => {
      let seed = 42;
      const random = () =>
        (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const initial = createCube(order);
      const moves = scrambleMoves(order, random);
      const scrambled = moves.reduce(applyMove, initial);
      expect(isSolved(scrambled)).toBe(false);
      expect(
        [...moves].reverse().map(inverseMove).reduce(applyMove, scrambled),
      ).toEqual(initial);
      const rotated = Array.from({ length: order }, (_, layer): CubeMove => ({
        axis: 0,
        layer,
        turns: 1,
      })).reduce(applyMove, initial);
      expect(isSolved(rotated)).toBe(true);
      expect(initial).toEqual(createCube(order));
    });
  }

  it("右面顺时针将右上前角转到右上后角", () => {
    const initial = createCube(3);
    const corner = initial.cubies.find((c) => c.position.join() === "2,2,2")!;
    const after = applyMove(initial, faceMove("R", 1, true, 3));
    expect(after.cubies.find((c) => c.id === corner.id)?.position).toEqual([
      2, 2, 0,
    ]);
    expect(faceMove("L", 2, true, 4)).toEqual({ axis: 0, layer: 1, turns: 1 });
  });

  it("不同平行层可交换，非法动作不修改状态", () => {
    const initial = createCube(4);
    const a: CubeMove = { axis: 1, layer: 0, turns: -1 };
    const b: CubeMove = { axis: 1, layer: 2, turns: 2 };
    expect(applyMove(applyMove(initial, a), b)).toEqual(
      applyMove(applyMove(initial, b), a),
    );
    expect(applyMove(initial, { ...a, layer: 9 })).toBe(initial);
  });
});
