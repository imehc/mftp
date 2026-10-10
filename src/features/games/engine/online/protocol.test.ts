import { describe, expect, it, vi } from "vitest";

import { goMoveParser } from "../../go/onlineProtocol";
import { parseGomokuMove } from "../../gomoku/onlineProtocol";
import { parseXiangqiMove } from "../../xiangqi/onlineProtocol";
import { ONLINE_PROTOCOL_VERSION, parseFrame } from "./protocol";

describe("落子校验的输出边界", () => {
  it("仅输出协议允许字段且不返回原对象", () => {
    const input = { row: 2, col: 3, extra: "discard" };
    const output = parseGomokuMove(input);
    expect(output).toEqual({ row: 2, col: 3 });
    expect(output).not.toBe(input);
    input.row = 8;
    expect(output?.row).toBe(2);
    expect(goMoveParser(9)({ kind: "pass", row: 100, extra: true })).toEqual({
      kind: "pass",
    });
    expect(
      goMoveParser(19)({ kind: "play", row: 18, col: 18, extra: true }),
    ).toEqual({ kind: "play", row: 18, col: 18 });
    expect(parseXiangqiMove({ from: 0, to: 89, extra: true })).toEqual({
      from: 0,
      to: 89,
    });
  });

  it.each([
    null,
    undefined,
    false,
    [],
    "move",
    {},
    { row: "1", col: 2 },
    { row: -1, col: 0 },
    { row: 1.5, col: 0 },
    { row: Infinity, col: 0 },
    { row: NaN, col: 0 },
  ])("拒绝无效五子棋输入 %j", (input) => {
    expect(parseGomokuMove(input)).toBeNull();
  });

  it("保留棋盘尺寸与象棋原地移动限制", () => {
    expect(parseGomokuMove({ row: 14, col: 14 })).not.toBeNull();
    expect(parseGomokuMove({ row: 15, col: 0 })).toBeNull();
    expect(goMoveParser(9)({ kind: "play", row: 9, col: 0 })).toBeNull();
    expect(goMoveParser(13)({ kind: "play", row: 12, col: 12 })).not.toBeNull();
    expect(parseXiangqiMove({ from: 2, to: 2 })).toBeNull();
    expect(parseXiangqiMove({ from: 0, to: 90 })).toBeNull();
  });
});

const control = {
  v: ONLINE_PROTOCOL_VERSION,
  round: 0,
  revision: 0,
  requestId: 1,
  atMove: 2,
  stateHash: "abc",
};

const moveFrame = {
  v: ONLINE_PROTOCOL_VERSION,
  t: "move",
  move: {
    round: 0,
    revision: 0,
    seq: 1,
    seat: 0,
    stateHash: "abc",
    move: { row: 1, col: 2 },
  },
};

describe("联机帧按类型分派", () => {
  it.each([
    { ...control, t: "undo-request", plies: 1 },
    { ...control, t: "undo-response", plies: 1, accept: true },
    { ...control, t: "rematch-request" },
    { ...control, t: "rematch-response", accept: false },
  ])("控制消息 %j 保留字段且不调用落子解析器", (message) => {
    const parseMove = vi.fn();
    expect(
      parseFrame(JSON.stringify({ ...message, extra: true }), parseMove),
    ).toEqual(message);
    expect(parseMove).not.toHaveBeenCalled();
  });

  it("合法落子只解析一次并去除帧内外额外字段", () => {
    const parseMove = vi.fn(parseGomokuMove);
    const input = {
      ...moveFrame,
      extra: true,
      move: {
        ...moveFrame.move,
        extra: true,
        move: { row: 1, col: 2, extra: true },
      },
    };
    expect(parseFrame(JSON.stringify(input), parseMove)).toEqual(moveFrame);
    expect(parseMove).toHaveBeenCalledOnce();
  });

  it.each([
    "not json",
    "null",
    "[]",
    JSON.stringify({ ...moveFrame, v: 1 }),
    JSON.stringify({ ...control, t: "undo-request", plies: 3 }),
    JSON.stringify({ ...control, t: "undo-response", plies: 1 }),
    JSON.stringify({ ...moveFrame, t: "unknown" }),
    JSON.stringify({ ...moveFrame, move: { ...moveFrame.move, seat: 2 } }),
    JSON.stringify({
      ...moveFrame,
      move: { ...moveFrame.move, move: { row: 99, col: 0 } },
    }),
  ])("拒绝非法消息 %s", (raw) => {
    expect(parseFrame(raw, parseGomokuMove)).toBeNull();
  });
});
