import { describe, expect, it, vi } from "vitest";

import type { TodoNoteDraft } from "~/bindings";

import { createNoteDraft } from "./note-draft";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const draft: TodoNoteDraft = {
  id: "draft",
  item: null,
  document: { version: 2, blocks: [] },
  baseRevision: null,
};

describe("待办备注草稿生命周期", () => {
  it("关闭后才创建成功的草稿仍会释放，且不写回已关闭会话", async () => {
    const pending = deferred<TodoNoteDraft>();
    const api = {
      begin: vi.fn(() => pending.promise),
      close: vi.fn(async () => {}),
    };
    const session = createNoteDraft(null, vi.fn(), api);
    session.start();
    session.stop();
    pending.resolve(draft);
    await vi.waitFor(() => expect(api.close).toHaveBeenCalledWith("draft"));
    expect(session.store.getState().draft).toBeNull();
  });

  it("严格模式的旧创建结果不会覆盖新会话", async () => {
    const old = deferred<TodoNoteDraft>();
    const api = {
      begin: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ ...draft, id: "next" }),
      close: vi.fn(async () => {}),
    };
    const session = createNoteDraft(null, vi.fn(), api);
    session.start();
    session.stop();
    session.start();
    await vi.waitFor(() =>
      expect(session.store.getState().draft?.id).toBe("next"),
    );
    old.resolve(draft);
    await vi.waitFor(() => expect(api.close).toHaveBeenCalledWith("draft"));
    expect(session.store.getState().draft?.id).toBe("next");
    session.stop();
  });

  it("释放失败保留错误反馈，不自动重放关闭写操作", async () => {
    const error = new Error("cleanup failed");
    const feedback = vi.fn();
    const api = {
      begin: vi.fn(async () => draft),
      close: vi.fn(async () => {
        throw error;
      }),
    };
    const session = createNoteDraft(null, feedback, api);
    session.start();
    session.stop();
    await vi.waitFor(() => expect(feedback).toHaveBeenCalledWith(error));
    expect(api.close).toHaveBeenCalledTimes(1);
  });
});
