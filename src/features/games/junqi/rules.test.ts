import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { BOARD_EDGES, isCamp, isHeadquarters } from "./board";
import { combat, RANK } from "./combat";
import { arrangeSide, canSwap, validDeployment } from "./deployment";
import { destinations, legalMoves } from "./movement";
import { applyAction, createInitialState, positionKey } from "./rules";
import {
  type Board,
  type JunqiState,
  type PieceKind,
  type Side,
} from "./types";

beforeAll(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

function boardWith(entries: [number, PieceKind, Side][]): Board {
  const board: Board = Array(60).fill(null);
  for (const [index, kind, side] of entries)
    board[index] = { id: `${index}`, kind, side };
  return board;
}

function playing(board: Board): JunqiState {
  const state: JunqiState = {
    ...createInitialState(),
    phase: "playing",
    ready: [true, true],
    board,
  };
  state.positions = { [positionKey(state)]: 1 };
  return state;
}

describe("军棋棋盘与布阵", () => {
  it("两边拓扑镜像，中央只有三条连接，行营和本营数量正确", () => {
    expect(
      BOARD_EDGES.filter(({ from, to }) => from < 30 && to >= 30),
    ).toHaveLength(3);
    expect(Array.from({ length: 60 }, (_, i) => i).filter(isCamp)).toHaveLength(
      10,
    );
    expect(
      Array.from({ length: 60 }, (_, i) => i).filter(isHeadquarters),
    ).toHaveLength(4);
    for (const edge of BOARD_EDGES)
      expect(BOARD_EDGES).toContainEqual({
        from: 59 - edge.to,
        to: 59 - edge.from,
        rail: edge.rail,
      });
  });

  it("多个随机种子都生成双方各二十五枚合法棋子且可复现", () => {
    for (let seed = 0; seed < 80; seed++) {
      const board = arrangeSide(
        arrangeSide(Array(60).fill(null), 0, seed),
        1,
        seed + 100,
      );
      expect(validDeployment(board, 0)).toBe(true);
      expect(validDeployment(board, 1)).toBe(true);
      expect(arrangeSide(board, 0, seed)).toEqual(board);
    }
  });

  it("拒绝交换军旗到普通站点、地雷到前排以及交换对方棋子", () => {
    const board = boardWith([
      [56, "flag", 0],
      [30, "engineer", 0],
      [50, "mine", 0],
      [25, "bomb", 1],
    ]);
    expect(canSwap(board, 56, 30, 0)).toBe(false);
    expect(canSwap(board, 50, 30, 0)).toBe(false);
    expect(canSwap(board, 30, 25, 0)).toBe(false);
  });
});

describe("军棋移动与保护", () => {
  it("普通棋沿铁路直行，工兵可在铁路转弯，任何棋子不得越子", () => {
    const board = boardWith([[30, "commander", 0]]);
    expect(destinations(board, 30)).toContain(50);
    expect(destinations(board, 30)).not.toContain(54);
    board[30] = { id: "e", kind: "engineer", side: 0 };
    expect(destinations(board, 30)).toContain(54);
    board[35] = { id: "block", kind: "mine", side: 0 };
    board[31] = { id: "block2", kind: "mine", side: 0 };
    board[25] = { id: "block3", kind: "mine", side: 0 };
    expect(destinations(board, 30)).not.toContain(50);
  });

  it("行营免受攻击、可斜线进入，地雷军旗与本营棋子不可移动", () => {
    const board = boardWith([
      [30, "commander", 0],
      [36, "platoon", 1],
      [56, "bomb", 0],
      [51, "mine", 0],
      [58, "flag", 0],
    ]);
    expect(destinations(board, 30)).not.toContain(36);
    board[36] = null;
    expect(destinations(board, 30)).toContain(36);
    for (const index of [56, 51, 58])
      expect(destinations(board, index)).toEqual([]);
  });
});

describe("军棋交战与终局", () => {
  it("普通棋子两两比较遵循等级，同级同归于尽", () => {
    const kinds = Object.keys(RANK).filter(
      (kind) => RANK[kind as PieceKind] > 0,
    ) as PieceKind[];
    for (const a of kinds)
      for (const b of kinds)
        expect(combat(a, b)).toBe(
          RANK[a] === RANK[b]
            ? "both"
            : RANK[a] > RANK[b]
              ? "attacker"
              : "defender",
        );
  });

  it("工兵排雷，炸弹同归于尽，炸弹也可夺旗", () => {
    expect(combat("engineer", "mine")).toBe("attacker");
    expect(combat("commander", "mine")).toBe("defender");
    for (const kind of Object.keys(RANK) as PieceKind[])
      if (kind !== "flag") expect(combat("bomb", kind)).toBe("both");
    expect(combat("bomb", "flag")).toBe("attacker");
  });

  it("夺旗优先于无吃子和棋，不能修改原局面或继续终局", () => {
    const state = playing(
      boardWith([
        [6, "bomb", 0],
        [1, "flag", 1],
        [56, "flag", 0],
      ]),
    );
    state.quiet = 99;
    const before = structuredClone(state);
    const next = applyAction(state, { type: "move", from: 6, to: 1 }, 0);
    expect(next.reason).toBe("flag");
    expect(next.winner).toBe(0);
    expect(state).toEqual(before);
    expect(() => applyAction(next, { type: "concede" }, 1)).toThrow();
  });

  it("无合法走法判负，主动认输不增加走棋数", () => {
    const state = playing(
      boardWith([
        [30, "commander", 0],
        [1, "flag", 1],
        [56, "flag", 0],
      ]),
    );
    expect(
      applyAction(state, { type: "move", from: 30, to: 31 }, 0).reason,
    ).toBe("immobilized");
    const result = applyAction(state, { type: "concede" }, 0);
    expect(result.winner).toBe(1);
    expect(result.ply).toBe(0);
  });

  it("重复局面及连续一百个无吃子半回合判和", () => {
    const state = playing(
      boardWith([
        [30, "platoon", 0],
        [25, "platoon", 1],
        [1, "flag", 1],
        [56, "flag", 0],
      ]),
    );
    state.quiet = 99;
    const move = { type: "move", from: 30, to: 31 } as const;
    expect(applyAction(state, move, 0).reason).toBe("no-capture");
    state.quiet = 0;
    const next = applyAction(state, move, 0);
    state.positions[positionKey(next)] = 2;
    expect(applyAction(state, move, 0).reason).toBe("repetition");
  });

  it("双方确认后才开始，错误座位和非法操作不改变局面", () => {
    let state = createInitialState();
    expect(() => applyAction(state, { type: "ready" }, 1)).toThrow();
    expect(() =>
      applyAction(state, { type: "move", from: 30, to: 25 }, 0),
    ).toThrow();
    state = applyAction(state, { type: "ready" }, 0);
    state = applyAction(state, { type: "ready" }, 1);
    expect(state.phase).toBe("playing");
    expect(state.turnSeat).toBe(0);
    expect(legalMoves(state.board, 0).length).toBeGreaterThan(0);
    expect(() =>
      applyAction(state, { type: "move", from: -1, to: 20 }, 0),
    ).toThrow();
  });
});
