import { useLingui } from "@lingui/react/macro";
import type { JSONContent } from "@tiptap/core";
import { Plugin, PluginKey, type SelectionBookmark } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Code, CornerDownLeft, ImagePlus, Redo2, Undo2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";

import type { TodoNoteDocument, TodoNoteDraft } from "~/bindings";
import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";

import {
  editorToNote,
  hasPendingImages,
  notePlainText,
  noteToEditor,
  readNoteClipboard,
  TODO_NOTE_CLIPBOARD_TYPE,
} from "./note-document";
import { createTodoNoteExtensions } from "./note-extensions";
import {
  canReadNoteClipboardImage,
  readNoteClipboardImage,
} from "./note-image-clipboard";
import { createNoteImports } from "./note-imports";
import { notePasteContent } from "./note-paste";
import {
  EditorNoteImage,
  NoteEditorContext,
  PendingNoteImage,
} from "./NoteEditorNodes";

const clipboardKey = new PluginKey("todoNoteClipboard");

function clipboardFiles(data: DataTransfer | null): File[] {
  const files = Array.from(data?.files ?? []);
  if (files.length) return files;
  return Array.from(data?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export interface NoteEditorStatus {
  draftId: string;
  ready: boolean;
  blocked: boolean;
}

export interface NoteEditorHandle {
  canSave: () => boolean;
  document: () => TodoNoteDocument;
  isDirty: () => boolean;
}

interface Props {
  draft: TodoNoteDraft;
  disabled: boolean;
  onChange: (document: TodoNoteDocument) => void;
  onStatus: (status: NoteEditorStatus) => void;
  onReady: (handle: NoteEditorHandle | null) => void;
}

export default function TodoNoteEditor(props: Props) {
  const { t } = useLingui();
  const editor = useEditor({
    extensions: [
      ...createTodoNoteExtensions(EditorNoteImage),
      PendingNoteImage,
    ],
    content: noteToEditor(props.draft.document),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        id: "todo-notes",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t`备注`,
        class:
          "min-h-36 min-w-0 px-3 py-2 text-sm leading-6 outline-none [&_p]:min-h-6 [&_p]:whitespace-pre-wrap [&_p]:break-words [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:wrap-anywhere [&_pre]:whitespace-pre-wrap",
      },
    },
  });
  // 导入队列、插件和初始快照属于具体编辑器实例；Tiptap 重建实例时必须一并重建。
  return editor ? (
    <EditorSurface key={editor.instanceId} {...props} editor={editor} />
  ) : null;
}

function EditorSurface({
  editor,
  draft,
  disabled,
  onChange,
  onStatus,
  onReady,
}: Props & { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const [imports] = useState(() => createNoteImports(editor, draft.id));
  const [initial] = useState(() => JSON.stringify(editor.getJSON()));
  const lastDocument = useRef(
    JSON.stringify(editorToNote(noteToEditor(draft.document))),
  );
  const importState = useStore(imports.store);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      code: current.isActive("codeBlock"),
      undo: current.can().undo(),
      redo: current.can().redo(),
      pending: hasPendingImages(current.getJSON()),
      document: current.getJSON(),
    }),
  });
  const synchronize = useEffectEvent(() => {
    onStatus({
      draftId: draft.id,
      ready: true,
      blocked: state.pending || importState.running,
    });
    if (!state.pending) {
      const document = editorToNote(state.document);
      const serialized = JSON.stringify(document);
      if (serialized !== lastDocument.current) {
        lastDocument.current = serialized;
        onChange(document);
      }
    }
  });
  const showImportError = useEffectEvent(() => {
    const error = imports.store.getState().error;
    if (!error) return;
    imports.clearError();
    toast.error(describeError(error, t));
  });
  useEffect(() => {
    if (importState.error) showImportError();
  }, [importState.error]);
  const register = useEffectEvent((handle: NoteEditorHandle | null) =>
    onReady(handle),
  );
  useEffect(() => {
    register({
      canSave: () =>
        !editor.isDestroyed &&
        !imports.store.getState().running &&
        !hasPendingImages(editor.getJSON()),
      document: () => editorToNote(editor.getJSON()),
      isDirty: () =>
        !editor.isDestroyed && JSON.stringify(editor.getJSON()) !== initial,
    });
    return () => register(null);
  }, [editor, imports, initial]);
  useEffect(() => {
    imports.start();
    return () => imports.stop();
  }, [imports]);
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    synchronize();
  }, [state.document, state.pending, importState.running]);

  useEffect(() => {
    let nativeTimer: ReturnType<typeof setTimeout> | undefined;
    let bookmark: SelectionBookmark | null = null;
    let fallbackUntil = 0;

    function cancelNativePaste() {
      clearTimeout(nativeTimer);
      nativeTimer = undefined;
      bookmark = null;
    }

    editor.registerPlugin(
      new Plugin({
        key: clipboardKey,
        state: {
          init: () => null,
          apply(transaction) {
            if (bookmark) bookmark = bookmark.map(transaction.mapping);
            return null;
          },
        },
        props: {
          handleKeyDown(_view, event) {
            if (
              event.key.toLowerCase() !== "v" ||
              !(event.metaKey || event.ctrlKey) ||
              event.altKey ||
              event.shiftKey ||
              event.isComposing ||
              disabled ||
              editor.isActive("codeBlock") ||
              !canReadNoteClipboardImage()
            )
              return false;
            cancelNativePaste();
            fallbackUntil = 0;
            bookmark = editor.state.selection.getBookmark();
            // 部分原生图片格式不会触发 WebKit paste，只有未收到事件时才走原生兜底。
            nativeTimer = setTimeout(() => {
              const selection = bookmark?.resolve(editor.state.doc);
              cancelNativePaste();
              if (!selection || editor.isDestroyed || !editor.isEditable)
                return;
              fallbackUntil = Date.now() + 500;
              imports.pasteClipboard(false, {
                from: selection.from,
                to: selection.to,
              });
            }, 100);
            return false;
          },
          handlePaste(_view, event) {
            cancelNativePaste();
            if (disabled || Date.now() < fallbackUntil) return true;
            if (editor.isActive("codeBlock")) return false;
            const data = event.clipboardData;
            const copied = readNoteClipboard(
              data?.getData(TODO_NOTE_CLIPBOARD_TYPE) ?? "",
            );
            if (!copied || (copied.draftId !== draft.id && !copied.itemId)) {
              const files = clipboardFiles(data);
              const html = data?.getData("text/html") ?? "";
              const native = canReadNoteClipboardImage();
              if (files.length || /<img[\s>]/i.test(html)) {
                const paste = notePasteContent(
                  data,
                  files,
                  native ? readNoteClipboardImage : undefined,
                );
                if (paste.content.length)
                  imports.pasteContent(paste.content, paste.sources);
                return true;
              }
              if (native && isNativeImagePaste(data)) {
                imports.pasteClipboard();
                return true;
              }
              return false;
            }
            imports.insert(
              copied.document,
              [],
              undefined,
              copied.draftId === draft.id ? undefined : copied.itemId!,
            );
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            if (disabled) return true;
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (moved || !files.length) return false;
            const position = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (
              position &&
              view.state.doc.resolve(position.pos).parent.type.name ===
                "codeBlock"
            )
              return true;
            imports.insert({ version: 2, blocks: [] }, files, position?.pos);
            return true;
          },
          handleDOMEvents: {
            copy(view, event) {
              if (view.state.selection.empty || !event.clipboardData)
                return false;
              try {
                const content = view.state.selection
                  .content()
                  .content.toJSON() as JSONContent[];
                const document = editorToNote({
                  type: "doc",
                  content: content.every((node) =>
                    ["text", "image", "hardBreak"].includes(node.type ?? ""),
                  )
                    ? [{ type: "paragraph", content }]
                    : content,
                });
                event.clipboardData.setData(
                  "text/plain",
                  notePlainText(document),
                );
                event.clipboardData.setData(
                  TODO_NOTE_CLIPBOARD_TYPE,
                  JSON.stringify({
                    itemId: draft.item?.id ?? null,
                    draftId: draft.id,
                    document,
                  }),
                );
                event.preventDefault();
                return true;
              } catch {
                return false;
              }
            },
          },
        },
      }),
      (incoming, plugins) => [
        ...plugins.filter((plugin) => plugin.spec.key !== clipboardKey),
        incoming,
      ],
    );
    return () => {
      cancelNativePaste();
      editor.unregisterPlugin(clipboardKey);
    };
  }, [editor, draft.id, draft.item?.id, imports, disabled]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="border-input focus-within:border-ring focus-within:ring-ring/50 min-w-0 rounded-md border focus-within:ring-2">
        <div
          className="border-border flex flex-wrap items-center gap-1 border-b px-1.5 py-1"
          role="group"
          aria-label={t`备注插入工具`}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || state.code}
            onClick={() => inputRef.current?.click()}
            aria-label={t`插入图片`}
            title={t`插入图片`}
          >
            <ImagePlus />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-pressed={state.code}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            aria-label={t`代码块`}
            title={t`代码块`}
          >
            <Code />
          </Button>
          {state.code ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => editor.chain().focus().exitCode().run()}
              aria-label={t`退出代码块`}
              title={t`退出代码块`}
            >
              <CornerDownLeft />
            </Button>
          ) : null}
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || !state.undo}
              onClick={() => editor.chain().focus().undo().run()}
              aria-label={t({
                message: "撤销",
                comment: "待办备注编辑器：撤销上一步内容修改",
              })}
            >
              <Undo2 />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || !state.redo}
              onClick={() => editor.chain().focus().redo().run()}
              aria-label={t({
                message: "重做",
                comment: "待办备注编辑器：恢复刚刚撤销的内容修改",
              })}
            >
              <Redo2 />
            </Button>
          </div>
        </div>
        <NoteEditorContext
          value={{
            scope: { itemId: draft.item?.id ?? null, draftId: draft.id },
            imports,
            disabled,
          }}
        >
          <EditorContent editor={editor} className="min-w-0" />
        </NoteEditorContext>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          imports.insert({ version: 2, blocks: [] }, files);
        }}
      />
    </div>
  );
}

function isNativeImagePaste(data: DataTransfer | null): boolean {
  const types = Array.from(data?.types ?? []).map((type) => type.toLowerCase());
  return (
    types.some(
      (type) => type.startsWith("image/") || type === "text/uri-list",
    ) ||
    (!types.includes("text/plain") && !types.includes("text/html"))
  );
}
