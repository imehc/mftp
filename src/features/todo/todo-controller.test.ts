import { describe, expect, it, vi } from "vitest";

import type { TodoItem, TodoItemInput } from "~/types";

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
    createdAt: 1,
    updatedAt: 1,
  };
}

const input: TodoItemInput = {
  title: "changed",
  category: null,
  notes: null,
  dueDate: null,
  dueAt: null,
  completed: false,
};
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
    create: vi.fn(async (_input: TodoItemInput) => item("new")),
    update: vi.fn(async (id: string, value: TodoItemInput) => ({
      ...item(id),
      ...value,
    })),
    remove: vi.fn(async (_id: string) => {}),
  };
  const controller = createTodoController(api);
  await controller.start();
  return { api, controller, state: controller.store.getState };
}

describe("待办写入生命周期", () => {
  it("同步拦截同项保存与切换，同时允许不同项更新", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem>();
    api.update.mockImplementationOnce(() => pending.promise);
    controller.edit(item());
    const save = controller.submit(input);
    expect(await controller.submit(input)).toBeNull();
    expect(await controller.toggle(item())).toBeNull();
    expect(await controller.toggle(item("b"))).toEqual({ ok: true });
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(state().pendingIds.has("a")).toBe(true);
    pending.resolve({ ...item(), ...input });
    await save;
    expect(state().pendingIds.size).toBe(0);
    expect(state().saving).toBe(false);
  });

  it("重复新建只发起一次且失败后可手动重试", async () => {
    const { api, controller, state } = await setup();
    const pending = deferred<TodoItem>();
    api.create.mockImplementationOnce(() => pending.promise);
    controller.edit(null);
    const save = controller.submit(input);
    expect(await controller.submit(input)).toBeNull();
    pending.reject(failure);
    expect(await save).toEqual({ ok: false, error: failure });
    expect(state().dialogOpen).toBe(true);
    expect(api.create).toHaveBeenCalledTimes(1);
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
    const pending = deferred<TodoItem>();
    api.update.mockImplementationOnce(() => pending.promise);
    controller.edit(item());
    const save = controller.submit(input);
    controller.setDialogOpen(false);
    controller.edit(item("b"));
    pending.resolve({ ...item(), ...input });
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
    api.update.mockImplementationOnce(() => pending.promise);
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
    expect(api.update).toHaveBeenLastCalledWith("a", {
      ...input,
      completed: true,
    });
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
    api.update.mockImplementationOnce(() => writing.promise);
    const toggle = controller.toggle(item("latest"));
    const readCount = api.list.mock.calls.length;
    await controller.load();
    expect(api.list).toHaveBeenCalledTimes(readCount);
    writing.resolve(item("latest"));
    await toggle;
  });
});
