import { describe, expect, it, vi } from "vitest";

import type {
  TodoNoteDetails,
  TodoNoteSaveInput,
  TodoNoteSummary,
} from "~/bindings";
import type { TodoItem } from "~/types";

import { createTodoController } from "./todo-controller";

function item(id = "a"): TodoItem {
  return {
    id,
    title: id,
    category: null,
    notes: null,
    dueDate: null,
    dueAt: null,
    completed: false,
    completedAt: null,
    priority: null,
    abandoned: false,
    abandonedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

const input: TodoNoteSaveInput = {
  draftId: "draft",
  document: { version: 1, blocks: [] },
  metadata: {
    title: "changed",
    category: null,
    notes: null,
    dueDate: null,
    dueAt: null,
    completed: false,
  },
};

function saved(id = "a"): TodoNoteDetails {
  return {
    item: { ...item(id), ...input.metadata },
    document: input.document,
    revision: 1,
  };
}

const failure = {
  kind: "external" as const,
  code: "test:write",
  message: "Write failed",
  args: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function setup() {
  const api = {
    list: vi.fn(async () => [item(), item("b")]),
    save: vi.fn(async (_input: TodoNoteSaveInput) => saved()),
    summaries: vi.fn(async (): Promise<TodoNoteSummary[]> => []),
    setCompleted: vi.fn(async (id: string, completed: boolean) => ({
      ...item(id),
      completed,
    })),
    setAbandoned: vi.fn(
      async (id: string, abandoned: boolean): Promise<TodoItem> => ({
        ...item(id),
        abandoned,
        abandonedAt: abandoned ? 2 : null,
      }),
    ),
    remove: vi.fn(async (_id: string) => {}),
  };
  const controller = createTodoController(api);
  await controller.start();
  return { api, controller, state: controller.store.getState };
}

describe("待办写入生命周期", () => {
  it("外部通知刷新列表与图片摘要但不关闭或替换正在编辑的草稿", async () => {
    const { api, controller, state } = await setup();
    const editing = state().items[0];
    controller.edit(editing);
    api.list.mockResolvedValueOnce([
      { ...item(), title: "MCP 更新后的标题" },
      item("b"),
    ]);
    api.summaries.mockResolvedValueOnce([
      { itemId: "a", revision: 2, imageCount: 0, firstImage: null },
    ]);
    controller.externalChanged();
    expect(state().loading).toBe(false);
    await vi.waitFor(() =>
      expect(state().items.find((entry) => entry.id === "a")?.title).toBe(
        "MCP 更新后的标题",
      ),
    );
    expect(state().summaries[0].revision).toBe(2);
    expect(state().dialogOpen).toBe(true);
    expect(state().editing).toBe(editing);
  });

  it("读取中的连续外部通知合并为一次补读且不会堆叠请求", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem[]>();
    api.list.mockImplementationOnce(() => pending.promise);
    controller.externalChanged();
    for (let index = 0; index < 8; index++) controller.externalChanged();
    expect(api.list).toHaveBeenCalledTimes(2);
    api.list.mockResolvedValueOnce([{ ...item(), title: "最新外部更新" }]);
    pending.resolve([item("old")]);
    await vi.waitFor(() => expect(state().items[0].title).toBe("最新外部更新"));
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(state().loading).toBe(false);
  });

  it("本地写入期间外部更新延后到真实请求退出后重读", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem>();
    api.setCompleted.mockImplementationOnce(() => pending.promise);
    const updating = controller.toggle(item());
    controller.externalChanged();
    controller.externalChanged();
    expect(api.list).toHaveBeenCalledTimes(1);
    api.list.mockResolvedValueOnce([
      { ...item(), title: "外部改名", completed: true },
    ]);
    pending.resolve({ ...item(), completed: true });
    await updating;
    await vi.waitFor(() => expect(state().items[0].title).toBe("外部改名"));
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(state().pendingIds.size).toBe(0);
  });

  it("页面停止后外部通知和迟到读取不更新状态", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem[]>();
    api.list.mockImplementationOnce(() => pending.promise);
    controller.externalChanged();
    controller.stop();
    controller.externalChanged();
    pending.resolve([item("late")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(state().items.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("摘要读取失败仍等到列表退出再处理排队外部更新", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem[]>();
    api.list.mockImplementationOnce(() => pending.promise);
    api.summaries.mockRejectedValueOnce(failure);
    controller.externalChanged();
    controller.externalChanged();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.list).toHaveBeenCalledTimes(2);
    api.list.mockResolvedValueOnce([{ ...item(), title: "失败后新的更新" }]);
    pending.resolve([item()]);
    await vi.waitFor(() =>
      expect(state().items[0].title).toBe("失败后新的更新"),
    );
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(state().loadError).toBeNull();
  });

  it("重新挂载时旧读取退出仍能释放排队的外部补读", async () => {
    const { api, controller, state } = await setup();
    const old = deferred<TodoItem[]>();
    api.list.mockImplementationOnce(() => old.promise);
    controller.externalChanged();
    controller.stop();
    await controller.start();
    api.list.mockResolvedValueOnce([{ ...item(), title: "新页面收到更新" }]);
    controller.externalChanged();
    expect(api.list).toHaveBeenCalledTimes(3);
    old.resolve([item("old-page")]);
    await vi.waitFor(() =>
      expect(state().items[0].title).toBe("新页面收到更新"),
    );
    expect(api.list).toHaveBeenCalledTimes(4);
  });

  it("同步拦截同项保存与切换，同时允许不同项更新", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoNoteDetails>();
    api.save.mockImplementationOnce(() => pending.promise);
    controller.edit(item());
    const save = controller.submit(input);
    expect(await controller.submit(input)).toBeNull();
    expect(await controller.toggle(item())).toBeNull();
    expect(await controller.toggle(item("b"))).toEqual({ ok: true });
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.setCompleted).toHaveBeenCalledTimes(1);
    expect(state().pendingIds.has("a")).toBe(true);
    pending.resolve(saved());
    await save;
    expect(state().pendingIds.size).toBe(0);
    expect(state().saving).toBe(false);
  });

  it("重复新建只发起一次且失败后可手动重试", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoNoteDetails>();
    api.save.mockImplementationOnce(() => pending.promise);
    api.save.mockResolvedValueOnce(saved("new"));
    controller.edit(null);
    const save = controller.submit(input);
    expect(await controller.submit(input)).toBeNull();
    pending.reject(failure);
    expect(await save).toEqual({ ok: false, error: failure });
    expect(state().dialogOpen).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(1);
    await controller.submit(input);
    expect(state().dialogOpen).toBe(false);
    expect(state().items.some((entry) => entry.id === "new")).toBe(true);
  });

  it("删除失败保留目标和结构化错误，重试成功才关闭", async () => {
    const { api, controller, state } = await setup();
    api.remove.mockRejectedValueOnce(failure);
    controller.setDeleting(item());
    await controller.remove();
    expect(state().deleting?.id).toBe("a");
    expect(state().deleteError).toEqual(failure);
    expect(state().items).toHaveLength(2);
    expect(api.remove).toHaveBeenCalledTimes(1);
    await controller.remove();
    expect(state().deleting).toBeNull();
    expect(state().deleteError).toBeNull();
    expect(state().items.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("删除进行中不允许切换目标、关闭确认或重复写入", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<void>();
    api.remove.mockImplementationOnce(() => pending.promise);
    controller.setDeleting(item());
    const deleting = controller.remove();
    controller.setDeleting(null);
    controller.setDeleting(item("b"));
    expect(state().deleting?.id).toBe("a");
    expect(await controller.remove()).toBeNull();
    expect(await controller.toggle(item())).toBeNull();
    pending.resolve();
    await deleting;
    expect(api.remove).toHaveBeenCalledTimes(1);
  });

  it("旧保存完成更新数据但不关闭后来打开的草稿", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoNoteDetails>();
    api.save.mockImplementationOnce(() => pending.promise);
    controller.edit(item());
    const save = controller.submit(input);
    controller.setDialogOpen(false);
    controller.edit(item("b"));
    pending.resolve(saved());
    await save;
    expect(state().dialogOpen).toBe(true);
    expect(state().editing?.id).toBe("b");
    expect(state().items.find((entry) => entry.id === "a")?.title).toBe(
      "changed",
    );
  });

  it("卸载后结果失效但请求退出前仍保留写锁", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem>();
    api.setCompleted.mockImplementationOnce(() => pending.promise);
    const updating = controller.toggle(item());
    controller.stop();
    expect(state().pendingIds.has("a")).toBe(true);
    pending.resolve({ ...item(), completed: true });
    expect(await updating).toBeNull();
    expect(state().items.find((entry) => entry.id === "a")?.completed).toBe(
      false,
    );
    expect(state().pendingIds.size).toBe(0);
  });

  it("切换状态时读取最新条目，避免旧行对象覆盖已保存字段", async () => {
    const { api, controller } = await setup();
    controller.edit(item());
    await controller.submit(input);
    await controller.toggle(item());
    expect(api.setCompleted).toHaveBeenLastCalledWith("a", true);
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("旧读取不能覆盖重试结果且写入期间不重新读取", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem[]>();
    api.list.mockImplementationOnce(() => pending.promise);
    const oldRead = controller.load();
    api.list.mockResolvedValueOnce([item("latest")]);
    await controller.load();
    pending.resolve([item("old")]);
    await oldRead;
    expect(state().items.map((entry) => entry.id)).toEqual(["latest"]);
    const writing = deferred<TodoItem>();
    api.setCompleted.mockImplementationOnce(() => writing.promise);
    const toggle = controller.toggle(item("latest"));
    const readCount = api.list.mock.calls.length;
    await controller.load();
    expect(api.list).toHaveBeenCalledTimes(readCount);
    writing.resolve(item("latest"));
    await toggle;
  });

  it("首图摘要读取失败不将已落库的保存误报为失败", async () => {
    const { api, controller, state } = await setup();
    api.summaries.mockRejectedValueOnce(failure);
    controller.edit(item());
    expect(await controller.submit(input)).toEqual({ ok: true });
    expect(state().dialogOpen).toBe(false);
    expect(state().items[0].title).toBe("changed");
    expect(state().summaryError).toEqual(failure);
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("废弃切换用返回的权威条目替换本地数据", async () => {
    const { api, controller, state } = await setup();
    expect(await controller.abandon(item())).toEqual({ ok: true });
    expect(api.setAbandoned).toHaveBeenLastCalledWith("a", true);
    const updated = state().items.find((entry) => entry.id === "a");
    expect(updated?.abandoned).toBe(true);
    expect(updated?.abandonedAt).toBe(2);
  });

  it("已废弃条目再次操作时恢复", async () => {
    const { api, controller, state } = await setup();
    await controller.abandon(item());
    expect(await controller.abandon(state().items[0])).toEqual({ ok: true });
    expect(api.setAbandoned).toHaveBeenLastCalledWith("a", false);
    expect(state().items.find((entry) => entry.id === "a")?.abandoned).toBe(
      false,
    );
  });

  it("废弃失败返回结构化错误且不改变本地条目", async () => {
    const { api, controller, state } = await setup();
    api.setAbandoned.mockRejectedValueOnce(failure);
    expect(await controller.abandon(item())).toEqual({
      ok: false,
      error: failure,
    });
    expect(state().items.find((entry) => entry.id === "a")?.abandoned).toBe(
      false,
    );
  });

  it("卸载后废弃结果失效但请求退出前仍保留写锁", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem>();
    api.setAbandoned.mockImplementationOnce(() => pending.promise);
    const updating = controller.abandon(item());
    controller.stop();
    expect(state().pendingIds.has("a")).toBe(true);
    pending.resolve({ ...item(), abandoned: true });
    expect(await updating).toBeNull();
    expect(state().items.find((entry) => entry.id === "a")?.abandoned).toBe(
      false,
    );
    expect(state().pendingIds.size).toBe(0);
  });
});
