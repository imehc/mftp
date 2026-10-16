import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createStore } from "zustand/vanilla";

import type { TodoNoteDocument } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  todoNoteClipboardRead,
  todoNoteImageCopy,
  todoNoteImageImport,
} from "~/lib/ipc";
import type { AppError } from "~/types";

import {
  noteError,
  noteImageIds,
  noteToEditor,
  TODO_NOTE_IMAGE_LIMIT,
  TODO_NOTE_INPUT_LIMIT,
} from "./note-document";
import { validateNoteImageInput } from "./note-image-input";
import { createNoteImportPreflight } from "./note-import-preflight";

export type NoteImageSource = File | (() => Promise<File | null>);

interface ImportJob {
  id: string;
  source: File | { itemId: string; assetId: string };
  status: "queued" | "processing" | "failed";
  error: AppError | null;
}

function locate(editor: Editor, id: string): number | null {
  let position: number | null = null;
  editor.state.doc.descendants((node, offset) => {
    if (node.type.name === "imageImport" && node.attrs.id === id)
      position = offset;
  });
  return position;
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

const defaultApi = {
  import: todoNoteImageImport,
  copy: todoNoteImageCopy,
  encode: fileBase64,
  clipboard: todoNoteClipboardRead,
  validate: validateNoteImageInput,
};

export function createNoteImports(
  editor: Editor,
  draftId: string,
  api: Pick<typeof defaultApi, "import" | "copy" | "encode" | "validate"> &
    Partial<Pick<typeof defaultApi, "clipboard">> = defaultApi,
) {
  const store = createStore<{
    jobs: ImportJob[];
    running: boolean;
    error: AppError | null;
  }>(() => ({ jobs: [], running: false, error: null }));
  let jobs: ImportJob[] = [];
  let active = false;
  let version = 0;
  let running = false;

  const preflight = createNoteImportPreflight(editor, publish, (error) => {
    store.setState({ error: toIpcError(error).payload });
  });

  function publish() {
    // 节点按任务快照订阅；保留对象引用会让失败状态仍显示为处理中。
    store.setState({
      jobs: jobs.map((job) => ({ ...job })),
      running: running || preflight.running,
    });
  }

  async function pump() {
    if (running || !active || editor.isDestroyed) return;
    const job = jobs.find(
      (entry) => entry.status === "queued" && locate(editor, entry.id) !== null,
    );
    if (!job) return;
    running = true;
    const run = version;
    job.status = "processing";
    publish();
    try {
      const image =
        job.source instanceof File
          ? await (async () => {
              const encoded = await api.encode(job.source as File);
              if (!active || version !== run || locate(editor, job.id) === null)
                return null;
              return (await api.import(draftId, encoded)).image;
            })()
          : await api.copy(draftId, job.source.itemId, job.source.assetId);
      if (!image) return;
      const replacement: ProseMirrorNode[] = [
        editor.schema.nodes.image.create({ assetId: image.id }),
      ];
      if (!active || version !== run || editor.isDestroyed) return;
      const position = locate(editor, job.id);
      if (position !== null) {
        editor.view.dispatch(
          closeHistory(
            editor.state.tr.replaceWith(position, position + 1, replacement),
          ).setMeta("addToHistory", false),
        );
      }
      jobs = jobs.filter((entry) => entry !== job);
    } catch (error) {
      if (
        active &&
        version === run &&
        !editor.isDestroyed &&
        locate(editor, job.id) !== null
      ) {
        job.status = "failed";
        job.error = toIpcError(error).payload;
      }
    } finally {
      running = false;
      publish();
      if (active) void pump();
    }
  }

  function insertReady(
    document: TodoNoteDocument,
    files: File[] = [],
    position?: number | { from: number; to: number },
    sourceItemId?: string,
    pastedContent?: JSONContent[],
  ) {
    if (!active || editor.isDestroyed || !editor.isEditable) return;
    jobs = jobs.filter(
      (job) => job.status === "processing" || locate(editor, job.id) !== null,
    );
    let existing = 0;
    const range =
      typeof position === "number"
        ? { from: position, to: position }
        : (position ?? editor.state.selection);
    editor.state.doc.descendants((node, offset) => {
      if (
        (node.type.name === "image" || node.type.name === "imageImport") &&
        !(offset >= range.from && offset + node.nodeSize <= range.to)
      )
        existing++;
    });
    const count = files.length + noteImageIds(document).length;
    if (existing + count > TODO_NOTE_IMAGE_LIMIT) {
      store.setState({ error: noteError("todo:note_image_limit").payload });
      return;
    }
    if (
      files.some(
        (file) =>
          file instanceof File &&
          (file.size > TODO_NOTE_INPUT_LIMIT || !file.size),
      )
    ) {
      store.setState({ error: noteError("todo:note_image_limit").payload });
      return;
    }
    const added: ImportJob[] = [];

    function pending(source: ImportJob["source"]): JSONContent {
      const id = crypto.randomUUID();
      added.push({ id, source, status: "queued", error: null });
      return { type: "imageImport", attrs: { id } };
    }

    function copyNode(node: JSONContent): JSONContent {
      if (node.type === "clipboardImage")
        return pending(files[node.attrs!.index as number]);
      if (node.type === "image" && sourceItemId)
        return pending({
          itemId: sourceItemId,
          assetId: node.attrs!.assetId as string,
        });
      return node.content
        ? { ...node, content: node.content.map(copyNode) }
        : node;
    }

    const blocks = pastedContent
      ? pastedContent.map(copyNode)
      : document.blocks.length
        ? (noteToEditor(document).content ?? []).map(copyNode)
        : [];
    // 单段内容按行内片段插入，保留光标两侧的文字；多段保留段落边界。
    const content =
      blocks.length === 1 && blocks[0].type === "paragraph"
        ? [...(blocks[0].content ?? [])]
        : blocks;
    if (!pastedContent) content.push(...files.map(pending));
    if (!content.length) return;
    const selection =
      position === undefined
        ? { from: editor.state.selection.from, to: editor.state.selection.to }
        : position;
    // 一次粘贴独立成一个撤销步骤，不与前后紧邻的键盘输入或删除合并。
    editor.view.dispatch(closeHistory(editor.state.tr));
    const selectedRange =
      typeof selection === "number"
        ? { from: selection, to: selection }
        : selection;
    const inserted = editor.commands.insertContentAt(selection, content, {
      // 预检期间若用户已经移动光标，插入只映射当前位置，不把光标抢回图片旁。
      updateSelection:
        editor.state.selection.from === selectedRange.from &&
        editor.state.selection.to === selectedRange.to,
    });
    if (!inserted) return;
    jobs.push(...added);
    store.setState({ error: null });
    publish();
    void pump();
  }

  function insert(
    document: TodoNoteDocument,
    sources: NoteImageSource[] = [],
    position?: number | { from: number; to: number },
    sourceItemId?: string,
    pastedContent?: JSONContent[],
  ) {
    if (!active || editor.isDestroyed || !editor.isEditable) return;
    if (!sources.length) {
      insertReady(document, [], position, sourceItemId, pastedContent);
      return;
    }
    if (
      sources.length + noteImageIds(document).length > TODO_NOTE_IMAGE_LIMIT ||
      sources.some(
        (source) =>
          source instanceof File &&
          (!source.size || source.size > TODO_NOTE_INPUT_LIMIT),
      )
    ) {
      store.setState({ error: noteError("todo:note_image_limit").payload });
      return;
    }
    preflight.run(async (valid) => {
      const files: File[] = [];
      for (const source of sources) {
        const file = typeof source === "function" ? await source() : source;
        if (!valid()) return null;
        if (!file) throw noteError("todo:note_image_unsupported");
        if (!file.size || file.size > TODO_NOTE_INPUT_LIMIT)
          throw noteError("todo:note_image_limit");
        await api.validate(file);
        if (!valid()) return null;
        files.push(file);
      }
      return (range) =>
        insertReady(document, files, range, sourceItemId, pastedContent);
    }, position);
  }

  return {
    store,
    insert,
    pasteClipboard(textOnly = false, position?: { from: number; to: number }) {
      preflight.run(async (valid) => {
        const result = await (api.clipboard ?? todoNoteClipboardRead)(
          draftId,
          textOnly,
        );
        if (!valid() || result.type === "empty") return null;
        if (result.type === "image")
          return (range) =>
            insertReady(
              {
                version: 2,
                blocks: [
                  {
                    type: "paragraph",
                    content: [{ type: "image", assetId: result.image.id }],
                  },
                ],
              },
              [],
              range,
            );
        if (new TextEncoder().encode(result.text).length > 256_000)
          throw noteError("todo:note_invalid");
        const content: JSONContent[] = result.text
          .split("\n")
          .flatMap((text, index) => [
            ...(index ? [{ type: "hardBreak" }] : []),
            ...(text ? [{ type: "text", text }] : []),
          ]);
        return (range) =>
          insertReady({ version: 2, blocks: [] }, [], range, undefined, [
            { type: "paragraph", content },
          ]);
      }, position);
    },
    pasteContent(content: JSONContent[], sources: NoteImageSource[]) {
      insert(
        { version: 2, blocks: [] },
        sources,
        undefined,
        undefined,
        content,
      );
    },
    clearError() {
      store.setState({ error: null });
    },
    retry(id: string) {
      const job = jobs.find((entry) => entry.id === id);
      if (!job || job.status !== "failed" || locate(editor, id) === null)
        return;
      job.status = "queued";
      job.error = null;
      publish();
      void pump();
    },
    start() {
      active = true;
      version++;
      preflight.start();
      void pump();
    },
    stop() {
      active = false;
      version++;
      preflight.stop();
      jobs = [];
      publish();
    },
  };
}

export type NoteImports = ReturnType<typeof createNoteImports>;
