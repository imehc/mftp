import type { Editor } from "@tiptap/core";
import {
  type SelectionBookmark,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";

// 预检不修改文档；异步读取期间用书签跟随原选区，避免失败时误删文字。
export function createNoteImportPreflight(
  editor: Editor,
  changed: () => void,
  failed: (error: unknown) => void,
) {
  const requests = new Set<{ bookmark: SelectionBookmark; valid: boolean }>();
  let active = false;
  let queue = Promise.resolve();

  function map({ transaction }: { transaction: Transaction }) {
    for (const request of requests) {
      if (!request.valid) continue;
      const selection = request.bookmark.resolve(transaction.before);
      if (transaction.mapping.mapResult(selection.from, 1).deletedAcross)
        request.valid = false;
      request.bookmark = request.bookmark.map(transaction.mapping);
    }
  }

  return {
    get running() {
      return requests.size > 0;
    },
    start() {
      if (active) return;
      active = true;
      editor.on("transaction", map);
    },
    stop() {
      active = false;
      editor.off("transaction", map);
      for (const request of requests) request.valid = false;
    },
    run(
      prepare: (
        valid: () => boolean,
      ) => Promise<((range: { from: number; to: number }) => void) | null>,
      position?: number | { from: number; to: number },
    ) {
      if (!active || editor.isDestroyed || !editor.isEditable) return;
      const selection =
        position === undefined
          ? editor.state.selection
          : TextSelection.create(
              editor.state.doc,
              typeof position === "number" ? position : position.from,
              typeof position === "number" ? position : position.to,
            );
      const request = { bookmark: selection.getBookmark(), valid: true };
      requests.add(request);
      changed();
      const valid = () =>
        active && request.valid && !editor.isDestroyed && editor.isEditable;
      // 连续粘贴串行完成预检；后一次书签会随前一次插入向后映射。
      queue = queue.then(async () => {
        try {
          if (!valid()) return;
          const apply = await prepare(valid);
          if (valid() && apply) {
            const range = request.bookmark.resolve(editor.state.doc);
            apply({ from: range.from, to: range.to });
          }
        } catch (error) {
          if (valid()) failed(error);
        } finally {
          requests.delete(request);
          changed();
        }
      });
    },
  };
}
