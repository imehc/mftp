import { createStore } from "zustand/vanilla";

import { toIpcError } from "~/lib/errors";
import {
  todoItemCreate,
  todoItemDelete,
  todoItemsList,
  todoItemUpdate,
} from "~/lib/ipc";
import type { AppError, TodoItem, TodoItemInput } from "~/types";

import { sortTodoItems } from "./todo-utils";

interface TodoState {
  items: TodoItem[];
  loading: boolean;
  loadError: AppError | null;
  editing: TodoItem | null;
  dialogOpen: boolean;
  deleting: TodoItem | null;
  deleteError: AppError | null;
  saving: boolean;
  pendingIds: Set<string>;
}

type WriteResult = { ok: true } | { ok: false; error: AppError } | null;

const defaultApi = {
  list: todoItemsList,
  create: todoItemCreate,
  update: todoItemUpdate,
  remove: todoItemDelete,
};

/** 页面实例拥有数据与写入准入；不持久化，也不重放失败的写操作。 */
export function createTodoController(api = defaultApi) {
  const store = createStore<TodoState>(() => ({
    items: [],
    loading: true,
    loadError: null,
    editing: null,
    dialogOpen: false,
    deleting: null,
    deleteError: null,
    saving: false,
    pendingIds: new Set(),
  }));
  let active = false;
  let lifetime = 0;
  let readVersion = 0;
  let editorVersion = 0;
  let deleteVersion = 0;

  async function load() {
    const state = store.getState();
    if (!active || state.saving || state.pendingIds.size) return;
    const run = ++readVersion;
    const life = lifetime;
    store.setState({ loading: true, loadError: null });
    try {
      const items = await api.list();
      if (active && lifetime === life && readVersion === run)
        store.setState({ items: sortTodoItems(items), loading: false });
    } catch (error) {
      if (active && lifetime === life && readVersion === run)
        store.setState({
          loadError: toIpcError(error).payload,
          loading: false,
        });
    }
  }

  function edit(item: TodoItem | null) {
    const state = store.getState();
    if (
      !active ||
      state.loading ||
      state.loadError ||
      (item && state.pendingIds.has(item.id))
    )
      return;
    editorVersion++;
    store.setState({ editing: item, dialogOpen: true });
  }

  function setDialogOpen(open: boolean) {
    if (!open) {
      editorVersion++;
      store.setState({ dialogOpen: false, editing: null });
    }
  }

  function setDeleting(item: TodoItem | null) {
    const state = store.getState();
    if (state.deleting && state.pendingIds.has(state.deleting.id)) return;
    if (
      item &&
      (state.loading || state.loadError || state.pendingIds.has(item.id))
    )
      return;
    deleteVersion++;
    store.setState({ deleting: item, deleteError: null });
  }

  async function write(
    id: string | null,
    saving: boolean,
    operation: () => Promise<void>,
  ): Promise<WriteResult> {
    const state = store.getState();
    if (
      !active ||
      state.loading ||
      state.loadError ||
      (saving && state.saving) ||
      (id && state.pendingIds.has(id))
    )
      return null;
    const life = lifetime;
    readVersion++;
    store.setState({
      pendingIds: id ? new Set(state.pendingIds).add(id) : state.pendingIds,
      ...(saving ? { saving: true } : {}),
    });
    try {
      await operation();
      return active && lifetime === life ? { ok: true } : null;
    } catch (error) {
      return active && lifetime === life
        ? { ok: false, error: toIpcError(error).payload }
        : null;
    } finally {
      // 锁直到实际请求退出才释放；卸载只让结果失效，不代表后端已取消。
      store.setState((current) => {
        const pendingIds = new Set(current.pendingIds);
        if (id) pendingIds.delete(id);
        return { pendingIds, ...(saving ? { saving: false } : {}) };
      });
    }
  }

  async function submit(input: TodoItemInput) {
    const { editing, dialogOpen } = store.getState();
    if (!dialogOpen) return null;
    const version = editorVersion;
    const life = lifetime;
    return write(editing?.id ?? null, true, async () => {
      const saved = editing
        ? await api.update(editing.id, input)
        : await api.create(input);
      if (!active || lifetime !== life) return;
      store.setState((state) => ({
        items: sortTodoItems(
          editing
            ? state.items.map((item) => (item.id === saved.id ? saved : item))
            : [...state.items, saved],
        ),
      }));
      // 关闭后重新打开的草稿，即使目标相同，也属于新的编辑会话。
      if (editorVersion === version) setDialogOpen(false);
    });
  }

  async function toggle(item: TodoItem) {
    const current = store
      .getState()
      .items.find((entry) => entry.id === item.id);
    if (!current) return null;
    const life = lifetime;
    return write(current.id, false, async () => {
      const saved = await api.update(current.id, {
        title: current.title,
        category: current.category,
        notes: current.notes,
        dueDate: current.dueDate,
        dueAt: current.dueAt,
        completed: !current.completed,
      });
      if (!active || lifetime !== life) return;
      store.setState((state) => ({
        items: sortTodoItems(
          state.items.map((entry) => (entry.id === saved.id ? saved : entry)),
        ),
      }));
    });
  }

  async function remove() {
    const target = store.getState().deleting;
    if (!target) return null;
    const life = lifetime;
    const version = deleteVersion;
    const result = await write(target.id, false, async () => {
      store.setState({ deleteError: null });
      await api.remove(target.id);
      if (!active || lifetime !== life) return;
      store.setState((state) => ({
        items: state.items.filter((item) => item.id !== target.id),
      }));
      if (deleteVersion === version)
        store.setState({ deleting: null, deleteError: null });
    });
    if (
      active &&
      lifetime === life &&
      result &&
      !result.ok &&
      deleteVersion === version
    )
      store.setState({ deleteError: result.error });
    return result;
  }

  return {
    store,
    load,
    edit,
    setDialogOpen,
    setDeleting,
    submit,
    toggle,
    remove,
    start() {
      active = true;
      return load();
    },
    stop() {
      active = false;
      lifetime++;
      readVersion++;
    },
  };
}
