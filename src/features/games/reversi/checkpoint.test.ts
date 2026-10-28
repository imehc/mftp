import { describe, expect, it } from "vitest";

import { LocalController } from "../engine/controllers";
import { MatchRunner } from "../engine/match";
import { reversiCheckpointSchema } from "./checkpoint";
import {
  applyReversiMove,
  createInitialReversiState,
  legalMoves,
  reversiGame,
} from "./rules";
import type { ReversiMove, ReversiState } from "./types";
import { undoPliesFor } from "./undo";

function fixture() {
  const history = [createInitialReversiState()];
  for (let i = 0; i < 12; i++)
    history.push(applyReversiMove(history[i], legalMoves(history[i])[0]).state);
  return {
    version: 1,
    gameId: "reversi",
    id: "d1c39456-7d2f-4ecf-8cc3-16b7b8ee6243",
    savedAt: 1,
    mode: { kind: "hotseat" },
    history,
  };
}

describe("黑白棋存档与悔棋", () => {
  it("完整重放校验拒绝伪造翻子、回合、初始状态与缺失历史", () => {
    const checkpoint = fixture();
    expect(reversiCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    for (const mutate of [
      (history: ReversiState[]) => {
        history[0].board[0] = 0;
      },
      (history: ReversiState[]) => {
        history[2].board[63] = 1;
      },
      (history: ReversiState[]) => {
        history[2].turnSeat = 1 - history[2].turnSeat;
      },
      (history: ReversiState[]) => {
        history[2].passedSeat = 1;
      },
      (history: ReversiState[]) => {
        history[2].finished = true;
      },
      (history: ReversiState[]) => {
        history.splice(2, 1);
      },
    ]) {
      const value = structuredClone(checkpoint);
      mutate(value.history);
      expect(reversiCheckpointSchema.safeParse(value).success).toBe(false);
    }
  });

  it("恢复后的 runner 可撤回落子和全部翻子，并继续合法对局", async () => {
    const checkpoint = reversiCheckpointSchema.parse(fixture());
    const local = new LocalController<ReversiState, ReversiMove>();
    const runner = new MatchRunner(
      reversiGame,
      createInitialReversiState(),
      [local, local],
      {},
      checkpoint,
    );
    runner.start();
    const plies = undoPliesFor(runner.getCheckpoint(), 0);
    expect(plies).toBe(2);
    expect(runner.undo(plies)).toBe(true);
    expect(runner.getSnapshot().state).toEqual(checkpoint.history[10]);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(local.submit(legalMoves(runner.getSnapshot().state)[0])).toBe(true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(runner.getSnapshot().state.moveCount).toBe(11);
    runner.dispose();
  });

  it("连续多次对手回应时回到本方真实落子之前", () => {
    const base = createInitialReversiState();
    const actors = [0, 1, 1, 1];
    const history = [
      base,
      ...actors.map((seat, i) => ({
        ...base,
        moveCount: i + 1,
        lastMove: { row: 0, col: i, seat },
      })),
    ];
    expect(undoPliesFor(history, 0)).toBe(4);
    expect(undoPliesFor(history, 1)).toBe(1);
    expect(undoPliesFor(history)).toBe(1);
    expect(undoPliesFor([base], 0)).toBe(0);
  });
});
