import { afterEach, describe, expect, it, vi } from "vitest";

import { chessAiStrategy } from "./ai";
import { createChessState } from "./rules";

class WorkerStub {
  static last: WorkerStub;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();

  constructor() {
    WorkerStub.last = this;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("国际象棋 AI Worker 生命周期", () => {
  it("取消正在搜索的任务后终止 Worker 并拒绝旧结果", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    const controller = new AbortController();
    const task = chessAiStrategy.chooseMove(
      createChessState(),
      0,
      "hard",
      controller.signal,
    );
    const worker = WorkerStub.last;
    const oldHandler = worker.onmessage;
    const result = expect(task).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    oldHandler?.({ data: { move: { type: "move", from: "e2", to: "e4" } } });
    await result;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it("已取消的任务不会创建 Worker", () => {
    const constructor = vi.fn();
    vi.stubGlobal("Worker", constructor);
    expect(() =>
      chessAiStrategy.chooseMove(
        createChessState(),
        0,
        "easy",
        AbortSignal.abort(),
      ),
    ).toThrow();
    expect(constructor).not.toHaveBeenCalled();
  });

  it("正常返回完整走法并释放 Worker", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    const task = chessAiStrategy.chooseMove(
      createChessState(),
      0,
      "medium",
      new AbortController().signal,
    );
    const move = { type: "move", from: "e2", to: "e4" };
    WorkerStub.last.onmessage?.({ data: { move } });
    await expect(task).resolves.toEqual(move);
    expect(WorkerStub.last.terminate).toHaveBeenCalledOnce();
  });

  it("异常消息和超时返回结构化错误而不是停留在思考状态", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    vi.useFakeTimers();
    const malformed = chessAiStrategy.chooseMove(
      createChessState(),
      0,
      "easy",
      new AbortController().signal,
    );
    WorkerStub.last.onmessage?.({
      data: { move: { type: "move", from: "e2", to: "e9" } },
    });
    await expect(malformed).rejects.toMatchObject({
      payload: { code: "chess:ai" },
    });
    const slow = chessAiStrategy.chooseMove(
      createChessState(),
      0,
      "hard",
      new AbortController().signal,
    );
    const result = expect(slow).rejects.toMatchObject({
      payload: { code: "chess:ai" },
    });
    await vi.advanceTimersByTimeAsync(8000);
    await result;
    expect(WorkerStub.last.terminate).toHaveBeenCalledOnce();
  });
});
