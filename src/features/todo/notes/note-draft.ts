import { createStore } from "zustand/vanilla";

import type { TodoNoteDraft } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { todoNoteDraftBegin, todoNoteDraftClose } from "~/lib/ipc";
import type { AppError } from "~/types";

const defaultApi = { begin: todoNoteDraftBegin, close: todoNoteDraftClose };

export function createNoteDraft(
  itemId: string | null,
  onCleanupError: (error: unknown) => void,
  api = defaultApi,
) {
  const store = createStore<{
    draft: TodoNoteDraft | null;
    error: AppError | null;
  }>(() => ({ draft: null, error: null }));
  let active = false;
  let version = 0;
  let opening: Promise<TodoNoteDraft> | null = null;

  function close(promise: Promise<TodoNoteDraft>) {
    void promise
      .then(
        (draft) => api.close(draft.id),
        () => {},
      )
      .catch(onCleanupError);
  }

  function start() {
    active = true;
    const run = ++version;
    store.setState({ draft: null, error: null });
    const promise = api.begin(itemId);
    opening = promise;
    void promise.then(
      (draft) => {
        if (active && run === version) store.setState({ draft });
      },
      (error: unknown) => {
        if (active && run === version)
          store.setState({ error: toIpcError(error).payload });
      },
    );
  }

  function stop() {
    active = false;
    version++;
    if (opening) close(opening);
    opening = null;
  }

  return { store, start, stop };
}
