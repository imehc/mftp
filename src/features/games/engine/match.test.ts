import { describe, expect, it, vi } from "vitest";

import { LocalController } from "./controllers";
import { MatchRunner } from "./match";
import type { GameDefinition, PlayerController } from "./types";

const game: GameDefinition<number, number, number> = {
  id: "test",
  seatCount: 1,
  currentSeat: () => 0,
  winnerSeat: () => null,
  isFinished: (state) => state >= 10,
  applyMove: (state, move) => ({ state: state + move, presentation: move }),
};

const tick = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

describe("对局暂停与稳定检查点", () => {
  it("表现失败仍展示已提交的规则状态，不回退到旧局面", async () => {
    const local = new LocalController<number, number>();
    const error = vi.fn();
    const runner = new MatchRunner(game, 0, [local], {
      onMoveResolved: () => {
        throw new Error("Synthetic presentation failure");
      },
      onError: error,
    });
    runner.start();
    local.submit(2);
    await tick();
    expect(runner.getCheckpoint()).toEqual([0, 2]);
    expect(runner.getSnapshot().state).toBe(2);
    expect(runner.getSnapshot().moveCount).toBe(1);
    expect(error).toHaveBeenCalledOnce();
    runner.dispose();
  });

  it("暂停后不接受新输入，恢复原局并保留悔棋历史", async () => {
    const local = new LocalController<number, number>();
    const runner = new MatchRunner(game, 0, [local]);
    runner.start();
    expect(local.submit(2)).toBe(true);
    await tick();
    runner.pause();
    await tick();
    expect(local.submit(3)).toBe(false);
    expect(runner.getCheckpoint()).toEqual([0, 2]);
    runner.resume();
    await tick();
    expect(local.submit(3)).toBe(true);
    await tick();
    expect(runner.getCheckpoint()).toEqual([0, 2, 5]);
    expect(runner.undo(1)).toBe(true);
    expect(runner.getSnapshot().state).toBe(2);
    runner.dispose();
  });

  it("已提交走法不因同一时刻切页被丢弃", async () => {
    const local = new LocalController<number, number>();
    const runner = new MatchRunner(game, 0, [local]);
    runner.start();
    local.submit(2);
    runner.pause();
    await tick();
    expect(runner.getCheckpoint()).toEqual([0, 2]);
    expect(local.awaitingInput).toBe(false);
    runner.dispose();
  });

  it("暂停期间完成的过期人工智能结果不能落子", async () => {
    let complete!: (move: number) => void;
    const ai: PlayerController<number, number> = {
      kind: "ai",
      requestMove: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    };
    const runner = new MatchRunner(game, 0, [ai]);
    runner.start();
    runner.pause();
    complete(2);
    await tick();
    expect(runner.getCheckpoint()).toEqual([0]);
    runner.resume();
    await tick();
    complete(10);
    await tick();
    expect(runner.getSnapshot().state).toBe(10);
    runner.dispose();
  });

  it("规则结算立即保存，不等待视觉表现完成", async () => {
    let finish!: () => void;
    const checkpoint = vi.fn();
    const local = new LocalController<number, number>();
    const runner = new MatchRunner(game, 0, [local], {
      onCheckpoint: checkpoint,
      onMoveResolved: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    runner.start();
    local.submit(2);
    await tick();
    expect(checkpoint).toHaveBeenCalledWith([0, 2]);
    expect(runner.getSnapshot().phase).toBe("resolving");
    runner.pause();
    finish();
    await tick();
    expect(runner.getSnapshot().state).toBe(2);
    expect(local.awaitingInput).toBe(false);
    runner.dispose();
  });

  it("恢复标识与完整历史，悔棋更新检查点", async () => {
    const local = new LocalController<number, number>();
    const checkpoint = vi.fn();
    const runner = new MatchRunner(
      game,
      0,
      [local],
      { onCheckpoint: checkpoint },
      { id: "same", history: [0, 2, 5] },
    );
    runner.start();
    expect(runner.id).toBe("same");
    expect(runner.getSnapshot().moveCount).toBe(2);
    runner.undo(1);
    expect(checkpoint).toHaveBeenCalledWith([0, 2]);
    runner.dispose();
  });

  it("反复暂停恢复与销毁不启动重复循环或重复清理", async () => {
    const local = new LocalController<number, number>();
    const dispose = vi.spyOn(local, "dispose");
    const runner = new MatchRunner(game, 0, [local]);
    runner.pause();
    runner.start();
    runner.resume();
    runner.pause();
    await tick();
    expect(local.awaitingInput).toBe(false);
    runner.resume();
    runner.start();
    await tick();
    local.submit(2);
    await tick();
    expect(runner.getSnapshot().moveCount).toBe(1);
    runner.dispose();
    runner.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
