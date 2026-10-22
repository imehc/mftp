import { createStore } from "zustand/vanilla";

import type { TodoNoteSaveInput, TodoNoteSummary } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  todoItemDelete,
  todoItemSetAbandoned,
  todoItemSetCompleted,
  todoItemsList,
  todoNoteSave,
  todoNoteSummaries,
} from "~/lib/ipc";
import type { AppError, TodoItem } from "~/types";

import { sortTodoItems } from "./todo-utils";

interface TodoState {
  items: TodoItem[];
  summaries: TodoNoteSummary[];
  summaryError: AppError | null;
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
  save: todoNoteSave,
  summaries: todoNoteSummaries,
  setCompleted: todoItemSetCompleted,
  setAbandoned: todoItemSetAbandoned,
  remove: todoItemDelete,
};

/** 页面实例拥有数据与写入准入；不持久化，也不重放失败的写操作。 */
export function createTodoController(api = defaultApi) {
  const store = createStore<TodoState>(() => ({
    items: [],
    summaries: [],
    summaryError: null,
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
  let externalPending = false;
  let reads = 0;

  function externalChanged() {
    if (!active) return;
    externalPending = true;
    flushExternalChanges();
  }

  function flushExternalChanges() {
    const state = store.getState();
    if (
      !active ||
      !externalPending ||
      reads ||
      state.saving ||
      state.pendingIds.size
    )
      return;
    externalPending = false;
    void read(true);
  }

  async function load() {
    return read(false);
  }

  async function read(background: boolean) {
    const state = store.getState();
    if (!active || state.saving || state.pendingIds.size) return;
    const run = ++readVersion;
    const life = lifetime;
    reads++;
    if (!background) store.setState({ loading: true, loadError: null });
    try {
      const [items, summaries] = await Promise.allSettled([
        api.list(),
        api.summaries(),
      ]);
      if (items.status === "rejected") throw items.reason;
      if (summaries.status === "rejected") throw summaries.reason;
      if (active && lifetime === life && readVersion === run)
        store.setState({
          items: sortTodoItems(items.value),
          summaries: summaries.value,
          summaryError: null,
          loadError: null,
          loading: false,
        });
      else if (background && active && lifetime === life)
        externalPending = true;
    } catch (error) {
      if (active && lifetime === life && readVersion === run)
        store.setState({
          loadError: toIpcError(error).payload,
          loading: false,
        });
    } finally {
      reads--;
      flushExternalChanges();
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
      flushExternalChanges();
    }
  }

  async function submit(input: TodoNoteSaveInput) {
    const { editing, dialogOpen } = store.getState();
    if (!dialogOpen) return null;
    const version = editorVersion;
    const life = lifetime;
    return write(editing?.id ?? null, true, async () => {
      const { item: saved } = await api.save(input);
      if (!active || lifetime !== life) return;
      store.setState((state) => ({
        items: sortTodoItems(
          editing
            ? state.items.map((item) => (item.id === saved.id ? saved : item))
            : [...state.items, saved],
        ),
        summaries: state.summaries.filter((entry) => entry.itemId !== saved.id),
      }));
      // 关闭后重新打开的草稿，即使目标相同，也属于新的编辑会话。
      if (editorVersion === version) setDialogOpen(false);
      try {
        const summaries = await api.summaries();
        if (active && lifetime === life)
          store.setState({ summaries, summaryError: null });
      } catch (error) {
        if (active && lifetime === life)
          store.setState({ summaryError: toIpcError(error).payload });
      }
    });
  }

  async function toggle(item: TodoItem) {
    const current = store
      .getState()
      .items.find((entry) => entry.id === item.id);
    if (!current) return null;
    const life = lifetime;
    return write(current.id, false, async () => {
      const saved = await api.setCompleted(current.id, !current.completed);
      if (!active || lifetime !== life) return;
      store.setState((state) => ({
        items: sortTodoItems(
          state.items.map((entry) => (entry.id === saved.id ? saved : entry)),
        ),
      }));
    });
  }

  async function abandon(item: TodoItem) {
    const current = store
      .getState()
      .items.find((entry) => entry.id === item.id);
    if (!current) return null;
    const life = lifetime;
    return write(current.id, false, async () => {
      // 与 set_completed 相同口径：以返回的权威条目替换，避免与完成状态互斥后不一致。
      const saved = await api.setAbandoned(current.id, !current.abandoned);
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
        summaries: state.summaries.filter(
          (entry) => entry.itemId !== target.id,
        ),
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
    externalChanged,
    edit,
    setDialogOpen,
    setDeleting,
    submit,
    toggle,
    abandon,
    remove,
    start() {
      active = true;
      return load();
    },
    stop() {
      active = false;
      lifetime++;
      readVersion++;
      externalPending = false;
    },
  };
}
